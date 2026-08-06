"use client";

import Image from "next/image";

export interface BrandIconProps {
  className?: string;
  size: number;
}

export function BrandIcon({ className, size }: BrandIconProps) {
  return (
    <Image
      alt=""
      aria-hidden="true"
      className={className}
      height={size}
      src="/icon.svg"
      unoptimized
      width={size}
    />
  );
}
