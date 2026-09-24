import type { Category } from "@/lib/types";

export const categories: Category[] = [
  { slug: "electronics", name: "Electronics", icon: "Smartphone", blurb: "Gadgets and everyday tech." },
  { slug: "gaming", name: "Gaming", icon: "Gamepad2", blurb: "Consoles, GPUs, and accessories." },
  { slug: "phones-accessories", name: "Phones & Accessories", icon: "Phone", blurb: "Phones, cases, and chargers." },
  { slug: "computers-laptops", name: "Computers & Laptops", icon: "Laptop", blurb: "Laptops, monitors, and parts." },
  { slug: "home-living", name: "Home & Living", icon: "House", blurb: "Appliances and home essentials." },
  { slug: "fashion", name: "Fashion", icon: "Shirt", blurb: "Clothing, bags, and footwear." },
  { slug: "beauty-health", name: "Beauty & Health", icon: "Sparkles", blurb: "Skincare, wellness, and care." },
  { slug: "sports-outdoor", name: "Sports & Outdoor", icon: "Dumbbell", blurb: "Fitness and outdoor gear." },
];

export function getCategory(slug: string): Category | undefined {
  return categories.find((category) => category.slug === slug);
}
