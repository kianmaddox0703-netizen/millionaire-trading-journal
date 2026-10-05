"use client";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui";

/** Opens the browser's print dialog; choose "Save as PDF" as the destination. */
export function PrintButton() {
  return <Button variant="primary" size="sm" onClick={() => window.print()}><Printer className="h-3.5 w-3.5" aria-hidden /> Save as PDF</Button>;
}
