import { V2_BRANDS, V2_ICONS } from "./iconsData";

export function V2Icon({
  name,
  className,
  size = 24,
}: {
  name: keyof typeof V2_ICONS | string;
  className?: string;
  size?: number;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: V2_ICONS[name] ?? "" }}
    />
  );
}

export function V2Brand({
  name,
  className,
  size = 24,
}: {
  name: keyof typeof V2_BRANDS | string;
  className?: string;
  size?: number;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: V2_BRANDS[name] ?? "" }}
    />
  );
}
