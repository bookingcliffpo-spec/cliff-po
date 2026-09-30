import type { Metadata } from "next";
import { Inter } from "next/font/google";

import { OpenHiggsfieldApp } from "@/openhiggsfield/openhiggsfield-app";

import "@/openhiggsfield/openhiggsfield.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-ohf-inter",
  display: "swap",
});

/* The full studio: every model, every setting. The home page is the simple
   upload → prompt → Generate version. */
export const metadata: Metadata = {
  title: "Advanced studio",
  alternates: { canonical: "/studio" },
};

export default function StudioPage() {
  return <OpenHiggsfieldApp fontClassName={inter.variable} />;
}
