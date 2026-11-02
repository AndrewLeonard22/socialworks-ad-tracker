/* Every number in the app is generated. This pill sits in each page header
   until Meta and the CRM/calendar sources are connected. */
export function DemoBadge() {
  return (
    <span
      className="status at-demo"
      data-tip="Sample numbers only. Meta, appointments, closed deals and revenue are not connected yet."
    >
      Dummy data
    </span>
  );
}
