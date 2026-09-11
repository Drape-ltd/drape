export default function OpsLoading() {
  return (
    <div className="ops-loading" aria-label="Loading authoritative Ops data" aria-live="polite">
      <div className="ops-loading-line" style={{ width: '18%' }} />
      <div className="ops-loading-line" style={{ width: '42%', height: 30 }} />
      <div className="ops-loading-line" style={{ width: '58%' }} />
      <div className="ops-loading-grid">
        {Array.from({ length: 8 }, (_, index) => <div className="ops-loading-cell" key={index} />)}
      </div>
    </div>
  )
}
