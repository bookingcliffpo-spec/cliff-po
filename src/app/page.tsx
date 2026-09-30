import type { Metadata } from "next";
import { Inter } from "next/font/google";

import { SimpleStudio } from "@/simple/simple-studio";

import "@/simple/simple.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sp-inter",
  display: "swap",
});

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

/** Upload → prompt → Generate. Everything else lives under "More settings",
    and the full studio is at /studio. */
export default function HomePage() {
  return <SimpleStudio fontClassName={inter.variable} />;
}
