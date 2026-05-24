"use client";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
export default function Sidebar() {
  const pathname = usePathname();
  return (
    <nav className="sidebar">
      <div>
        <Link href="/">
          <Image
            src="/foxplay-logo.svg"
            alt="Foxplay"
            width={100}
            height={100}
            loading="eager"
          />
        </Link>
        <Link href="/servers/create" className="newGameButton">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="lucide lucide-plus-icon lucide-plus"
          >
            <path d="M5 12h14" />
            <path d="M12 5v14" />
          </svg>
          <span>New server</span>
        </Link>
        <Link
          href="/servers"
          className={`nav${pathname === "/servers" ? " selected" : ""}`}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            stroke-linejoin="round"
            className="lucide lucide-server-icon lucide-server"
          >
            <rect width="20" height="8" x="2" y="2" rx="2" ry="2" />
            <rect width="20" height="8" x="2" y="14" rx="2" ry="2" />
            <line x1="6" x2="6.01" y1="6" y2="6" />
            <line x1="6" x2="6.01" y1="18" y2="18" />
          </svg>
          <span>Servers</span>
        </Link>
        <Link
          href="/friends"
          className={`nav${pathname === "/friends" ? " selected" : ""}`}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="lucide lucide-users-icon lucide-users"
          >
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
            <path d="M16 3.128a4 4 0 0 1 0 7.744" />
            <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
            <circle cx="9" cy="7" r="4" />
          </svg>
          <span>Friends</span>
        </Link>
      </div>

      <div>
        <div className="profile">
          <div className="image"></div>
          <div>
            <div className="name">Wen Kang</div>
            <div className="plan">Plan</div>
          </div>
        </div>
      </div>
    </nav>
  );
}
