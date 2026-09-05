/** Route stub. Each track replaces its own placeholders — see PLAN.md. */
export default function Placeholder({ title, owner }) {
  return (
    <>
      <div className="page-head"><h1>{title}</h1><span className="badge badge-accent">{owner}</span></div>
      <div className="card card-pad-lg state">
        <h3>{title} is not built yet</h3>
        <p className="muted">
          The API for this module is already live. Build this screen against it — see PLAN.md for the
          endpoints and the acceptance checklist for {owner}.
        </p>
      </div>
    </>
  );
}
