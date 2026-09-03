import { connection } from "next/server";
import { ReplayWorkspace } from "@/components/replay-workspace";

export default async function Home() {
  await connection();
  return <ReplayWorkspace />;
}
