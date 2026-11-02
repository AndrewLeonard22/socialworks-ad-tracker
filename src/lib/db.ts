/* SERVER ONLY: the tracker's small database. Imported by route handlers and the
   other server modules, never by a page or component.

   On Vercel it is the connected Amazon DynamoDB table, reached with Vercel's OIDC
   role (no stored AWS keys). Env, set by the Vercel integration:
     AWS_REGION, AWS_ROLE_ARN, DYNAMODB_TABLE_NAME,
     DYNAMODB_TABLE_PARTITION_KEY (PK), DYNAMODB_TABLE_SORT_KEY (SK)
   Without a table (local runs and tests) it keeps everything in memory.

   Each item is { PK, SK, data, v }: `v` counts writes, so a caller can write only
   if nobody else wrote since it read (used for the rotating GHL token). This is
   the one file that knows where data lives; moving off DynamoDB means swapping it. */

import { ConditionalCheckFailedException, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { awsCredentialsProvider } from "@vercel/functions/oidc";

export interface Item<T> {
  sk: string;
  data: T;
  /** write count; 0 when the item does not exist yet */
  v: number;
}

const table = () => process.env.DYNAMODB_TABLE_NAME?.trim() ?? "";
const PK = () => process.env.DYNAMODB_TABLE_PARTITION_KEY?.trim() || "PK";
const SK = () => process.env.DYNAMODB_TABLE_SORT_KEY?.trim() || "SK";

/** a write lost a race: someone else wrote the item since it was read */
export class Conflict extends Error {}

let doc: DynamoDBDocumentClient | null = null;
function dynamo() {
  if (!doc) {
    const roleArn = process.env.AWS_ROLE_ARN?.trim();
    const base = new DynamoDBClient({
      region: process.env.AWS_REGION?.trim(),
      ...(roleArn ? { credentials: awsCredentialsProvider({ roleArn }) } : {}),
      maxAttempts: 3,
    });
    doc = DynamoDBDocumentClient.from(base, { marshallOptions: { removeUndefinedValues: true } });
  }
  return doc;
}

/* local stand-in, kept on globalThis so dev reloads don't wipe it */
const g = globalThis as unknown as { __atMem?: Map<string, Map<string, { data: unknown; v: number }>> };
const mem = (g.__atMem ??= new Map());
const part = (pk: string) => {
  let m = mem.get(pk);
  if (!m) mem.set(pk, (m = new Map()));
  return m;
};

export async function getItem<T>(pk: string, sk: string): Promise<Item<T> | null> {
  if (!table()) {
    const hit = part(pk).get(sk);
    return hit ? { sk, data: structuredClone(hit.data) as T, v: hit.v } : null;
  }
  const r = await dynamo().send(
    new GetCommand({ TableName: table(), Key: { [PK()]: pk, [SK()]: sk }, ConsistentRead: true })
  );
  return r.Item ? { sk, data: r.Item.data as T, v: Number(r.Item.v) || 0 } : null;
}

/** every item under a partition key */
export async function listItems<T>(pk: string): Promise<Item<T>[]> {
  if (!table()) {
    return [...part(pk)].map(([sk, hit]) => ({ sk, data: structuredClone(hit.data) as T, v: hit.v }));
  }
  const out: Item<T>[] = [];
  let start: Record<string, unknown> | undefined;
  do {
    const r = await dynamo().send(
      new QueryCommand({
        TableName: table(),
        KeyConditionExpression: "#pk = :pk",
        ExpressionAttributeNames: { "#pk": PK() },
        ExpressionAttributeValues: { ":pk": pk },
        ExclusiveStartKey: start,
        ConsistentRead: true,
      })
    );
    for (const it of r.Items ?? []) out.push({ sk: String(it[SK()]), data: it.data as T, v: Number(it.v) || 0 });
    start = r.LastEvaluatedKey;
  } while (start);
  return out;
}

/** write an item; with `ifV`, only when its write count is still `ifV` (0 = must not exist), else Conflict */
export async function putItem<T>(pk: string, sk: string, data: T, ifV?: number): Promise<number> {
  if (!table()) {
    const m = part(pk);
    const cur = m.get(sk)?.v ?? 0;
    if (ifV !== undefined && cur !== ifV) throw new Conflict("changed since read");
    m.set(sk, { data: structuredClone(data), v: cur + 1 });
    return cur + 1;
  }
  const next = (ifV ?? 0) + 1;
  try {
    if (ifV === undefined) {
      /* unconditional: bump whatever count is there */
      const cur = (await getItem<T>(pk, sk))?.v ?? 0;
      await dynamo().send(
        new PutCommand({ TableName: table(), Item: { [PK()]: pk, [SK()]: sk, data, v: cur + 1, at: Date.now() } })
      );
      return cur + 1;
    }
    await dynamo().send(
      new PutCommand({
        TableName: table(),
        Item: { [PK()]: pk, [SK()]: sk, data, v: next, at: Date.now() },
        ...(ifV === 0
          ? { ConditionExpression: "attribute_not_exists(#pk)", ExpressionAttributeNames: { "#pk": PK() } }
          : { ConditionExpression: "#v = :v", ExpressionAttributeNames: { "#v": "v" }, ExpressionAttributeValues: { ":v": ifV } }),
      })
    );
    return next;
  } catch (e) {
    if (e instanceof ConditionalCheckFailedException) throw new Conflict("changed since read");
    throw e;
  }
}

/** a short, plain explanation of a storage failure (never the AWS internals) */
export function explainDb(e: unknown) {
  const name = e instanceof Error ? e.name : "";
  if (/AccessDenied|Unrecognized|InvalidIdentityToken|ExpiredToken|CredentialsProvider|OIDC/i.test(name + String(e))) {
    return "The tracker can't reach its database. Check the DynamoDB connection in Vercel Storage.";
  }
  if (/ResourceNotFound/i.test(name)) return "The tracker's DynamoDB table is missing. Reconnect it in Vercel Storage.";
  return "The tracker's database didn't answer, try again shortly";
}
