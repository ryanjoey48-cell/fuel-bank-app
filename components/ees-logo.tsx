"use client";

import clsx from "clsx";
import Image from "next/image";
import { useState } from "react";

type EESLogoProps = {
  alt?: string;
  className?: string;
  priority?: boolean;
  size?: number;
};

export function EESLogo({
  alt = "EES",
  className,
  priority = false,
  size = 40
}: EESLogoProps) {
  const [imageFailed, setImageFailed] = useState(false);

  if (imageFailed) {
    return (
      <span
        className={clsx(
          "inline-flex shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-orange-500 to-rose-600 text-[0.68rem] font-black tracking-tight text-white",
          className
        )}
        style={{ width: size, height: size }}
        role="img"
        aria-label={alt}
      >
        EES
      </span>
    );
  }

  return (
    <Image
      src="/ees-logo.png"
      alt={alt}
      width={size}
      height={size}
      className={clsx("shrink-0 object-contain", className)}
      priority={priority}
      onError={() => setImageFailed(true)}
    />
  );
}
