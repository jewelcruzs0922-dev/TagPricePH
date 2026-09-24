export default function ProductLoading() {
  return (
    <div className="container-page py-8" aria-busy="true">
      <div className="mb-6 skeleton h-5 w-48" />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card p-5">
          <div className="skeleton h-72 w-full rounded-2xl" />
        </div>
        <div className="card space-y-4 p-6">
          <div className="skeleton h-4 w-24" />
          <div className="skeleton h-9 w-3/4" />
          <div className="skeleton h-16 w-full rounded-xl" />
          <div className="skeleton h-12 w-1/2" />
          <div className="skeleton h-12 w-full rounded-full" />
        </div>
      </div>
    </div>
  );
}
