"use client";
import { usePathname } from "next/navigation";

export default function Sidebar() {
  const pathname = usePathname();
  let details = "";
  if (pathname === "/servers") {
    details = "Your servers";
  } else if (pathname === "/friends") {
    details = "Your friends";
  }
  return (
    <div className="header">
      <div>{details}</div>
    </div>
  );
}
