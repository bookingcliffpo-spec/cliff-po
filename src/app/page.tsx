import type { Metadata } from "next";
import { Inter } from "next/font/google";

import { MotionStudio } from "@/motion/motion-studio";

import "@/motion/motion.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-mo-inter",
  display: "swap",
});

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

/** The phone-first home page: model card, prompt, Settings · Media · Upload,
    Generate, and the jobs list. /simple keeps the one-card page and /studio
    the full studio. */
export default function HomePage() {
  return <MotionStudio fontClassName={inter.variable} />;
}
