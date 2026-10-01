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
  alternates: { canonical: "/simple" },
};

/** Upload → prompt → Generate. Everything else lives under "More settings",
    the new home page is at /, the full studio at /studio. */
export default function SimplePage() {
  return <SimpleStudio fontClassName={inter.variable} />;
}
