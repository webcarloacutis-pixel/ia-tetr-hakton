import type { Metadata } from "next";

import { EcommerceAudioTest } from "@/components/modules/ecommerce-audio-test";

export const metadata: Metadata = {
  title: "Prueba de voz ecommerce",
};

export default function AudioTestPage() {
  return <EcommerceAudioTest />;
}
