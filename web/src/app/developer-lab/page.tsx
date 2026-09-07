"use client";
import { useRouter } from "next/navigation";
import { InteractiveCase } from "@/components/interactive-case";
export default function DeveloperLab() {
  const router = useRouter();
  return <main><InteractiveCase external onExit={() => { router.push("/"); }} /></main>;
}
