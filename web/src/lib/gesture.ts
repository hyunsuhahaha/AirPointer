export type GesturePose = "palm" | "fist" | "other" | "none";
export type GestureCommand = "capture-now" | "send-replay";

export class GestureCommandDetector {
  private phase: "idle" | "arming" | "armed" | "cooldown" = "idle";
  private startedAt = 0;

  update(pose: GesturePose, now: number): GestureCommand | null {
    if (pose === "none") {
      this.phase = "idle";
      return null;
    }
    if (this.phase === "cooldown") return null;
    if (pose === "palm" && this.phase === "idle") {
      this.phase = "arming";
      this.startedAt = now;
      return null;
    }
    if (this.phase === "arming") {
      if (pose === "palm" && now - this.startedAt >= 250) this.phase = "armed";
      else if (pose !== "palm") this.phase = "idle";
      return null;
    }
    if (this.phase === "armed") {
      const held = now - this.startedAt;
      if (pose === "fist" && held <= 1_250) {
        this.phase = "cooldown";
        return "capture-now";
      }
      if (pose === "palm" && held >= 1_200) {
        this.phase = "cooldown";
        return "send-replay";
      }
      if (pose === "other" || held > 1_600) this.phase = "idle";
    }
    return null;
  }
}

type Point = { x: number; y: number };

export function classifyHand(landmarks: Point[]): GesturePose {
  if (landmarks.length < 21) return "none";
  const wrist = landmarks[0];
  const tips = [8, 12, 16, 20];
  const pips = [6, 10, 14, 18];
  const extended = tips.filter((tip, index) => {
    const tipDistance = Math.hypot(landmarks[tip].x - wrist.x, landmarks[tip].y - wrist.y);
    const pipDistance = Math.hypot(landmarks[pips[index]].x - wrist.x, landmarks[pips[index]].y - wrist.y);
    return tipDistance > pipDistance * 1.18;
  }).length;
  if (extended >= 4) return "palm";
  if (extended <= 1) return "fist";
  return "other";
}
