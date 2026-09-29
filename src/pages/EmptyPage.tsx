/** Week, Trackers, and Setup are title-only in Milestone 1. */
export function EmptyPage({ title }: { title: string }) {
  return (
    <div className="flex h-full flex-col gap-4 px-7 pb-6 pt-5">
      <div className="flex h-control items-center">
        <h1 className="page-title m-0">{title}</h1>
      </div>
    </div>
  );
}
