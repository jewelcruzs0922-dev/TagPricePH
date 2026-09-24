import { ProductGridSkeleton } from "@/components/ui/States";

export default function SearchLoading() {
  return (
    <div className="container-page py-8 sm:py-10">
      <div className="mb-6 max-w-2xl space-y-3" aria-busy="true">
        <div className="skeleton h-9 w-2/3" />
        <div className="skeleton h-5 w-full" />
        <div className="skeleton h-12 w-full max-w-xl rounded-full" />
      </div>
      <ProductGridSkeleton count={8} />
    </div>
  );
}
