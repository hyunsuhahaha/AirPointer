export type GesturePose = "palm" | "fist" | "point" | "other" | "none";
export type GestureCommand = "start-region" | "send-replay";
export type GesturePoint = { x: number; y: number };
export type NormalizedRegion = { left: number; top: number; right: number; bottom: number };
export type GestureProgress = {
  phase: "idle" | "holding" | "sent";
  value: number;
  command: GestureCommand | null;
};
export type RegionSelectionView = {
  phase: "idle" | "waiting" | "selecting" | "confirming" | "cooldown";
  rect: NormalizedRegion | null;
  pointer: GesturePoint | null;
  progress: number;
  captured: NormalizedRegion | null;
};

export class GestureCommandDetector {
  private phase: "idle" | "arming" | "armed" | "cooldown" = "idle";
  private route: "region" | "replay" | null = null;
  private startedAt = 0;
  private armedAt = 0;
  private regionPrimedUntil = 0;
  private lastCommand: GestureCommand | null = null;

  update(pose: GesturePose, now: number): GestureCommand | null {
    // Real hand opening commonly produces a few `other` or `none` frames.
    // Latch any confidently observed fist so the following palm cannot fall
    // through into the two-second replay gesture.
    if (pose === "fist" && this.phase !== "cooldown") this.regionPrimedUntil = now + 1_800;
    if (pose === "palm" && this.phase !== "cooldown" && this.regionPrimedUntil > 0 && this.regionPrimedUntil >= now) {
      this.regionPrimedUntil = 0;
      return this.emit("start-region");
    }
    if (pose === "none") {
      this.phase = "idle";
      this.route = null;
      this.lastCommand = null;
      return null;
    }
    if (this.phase === "cooldown") return null;
    if (this.phase === "idle" && (pose === "palm" || pose === "fist")) {
      this.phase = "arming";
      this.route = pose === "fist" ? "region" : "replay";
      this.startedAt = now;
      return null;
    }
    if (this.phase === "arming") {
      const elapsed = now - this.startedAt;
      if (this.route === "region") {
        if (pose === "palm" && elapsed >= 80 && elapsed <= 1_500) return this.emit("start-region");
        if (elapsed > 1_500) {
          this.phase = "idle";
          this.route = null;
        } else if (pose === "fist" && elapsed >= 120) {
          this.phase = "armed";
          this.armedAt = now;
        }
        // Opening a real hand passes through several "other" frames. Keep the
        // region sequence alive instead of treating the final palm as a new hold.
        return null;
      }
      if (pose === "palm" && elapsed >= 250) {
        this.phase = "armed";
        this.armedAt = now;
      } else if (pose !== "palm") {
        this.phase = "idle";
        this.route = null;
      }
      return null;
    }
    if (this.phase === "armed" && this.route === "region") {
      if (pose === "palm" && now - this.armedAt <= 1_500) return this.emit("start-region");
      if (now - this.armedAt > 1_500) {
        this.phase = "idle";
        this.route = null;
      }
      return null;
    }
    if (this.phase === "armed" && this.route === "replay") {
      const held = now - this.startedAt;
      if (pose === "palm" && held >= 2_000) return this.emit("send-replay");
      if (pose !== "palm" || held > 2_400) {
        this.phase = "idle";
        this.route = null;
      }
    }
    return null;
  }

  progress(now: number): GestureProgress {
    if (this.phase === "cooldown") return { phase: "sent", value: 1, command: this.lastCommand };
    if (this.phase === "arming" || this.phase === "armed") {
      const duration = this.route === "region" ? 120 : 2_000;
      return { phase: "holding", value: Math.min(1, Math.max(0, (now - this.startedAt) / duration)), command: this.route === "region" ? "start-region" : null };
    }
    return { phase: "idle", value: 0, command: null };
  }

  private emit(command: GestureCommand): GestureCommand {
    this.phase = "cooldown";
    this.lastCommand = command;
    return command;
  }
}

export class RegionSelectionDetector {
  private phase: RegionSelectionView["phase"] = "idle";
  private anchor: GesturePoint | null = null;
  private pointer: GesturePoint | null = null;
  private rect: NormalizedRegion | null = null;
  private fistAt = 0;
  private missingAt = 0;

  get active() { return this.phase !== "idle"; }

  start(): RegionSelectionView {
    this.phase = "waiting";
    this.anchor = this.pointer = null;
    this.rect = null;
    this.fistAt = this.missingAt = 0;
    return this.view();
  }

  update(pose: GesturePose, pointer: GesturePoint | null, now: number): RegionSelectionView {
    if (!this.active) return this.view();
    if (this.phase === "cooldown") {
      if (pose === "none") this.reset();
      return this.view();
    }
    if (pose === "none") {
      if (!this.missingAt) this.missingAt = now;
      else if (now - this.missingAt >= 1_500) this.reset();
      return this.view();
    }
    this.missingAt = 0;
    if (pose === "point" && pointer) {
      this.pointer = clampPoint(pointer);
      if (!this.anchor) this.anchor = this.pointer;
      this.rect = normalizeRegion(this.anchor, this.pointer);
      this.phase = "selecting";
      this.fistAt = 0;
      return this.view();
    }
    if (pose === "fist" && this.rect && regionIsLargeEnough(this.rect)) {
      if (!this.fistAt) this.fistAt = now;
      const progress = Math.min(1, (now - this.fistAt) / 220);
      this.phase = "confirming";
      if (progress >= 1) {
        this.phase = "cooldown";
        return { ...this.view(), progress: 1, captured: this.rect };
      }
      return { ...this.view(), progress };
    }
    this.fistAt = 0;
    if (this.rect) this.phase = "selecting";
    return this.view();
  }

  private view(): RegionSelectionView {
    return { phase: this.phase, rect: this.rect, pointer: this.pointer, progress: 0, captured: null };
  }

  private reset() {
    this.phase = "idle";
    this.anchor = this.pointer = null;
    this.rect = null;
    this.fistAt = this.missingAt = 0;
  }
}

type Point = { x: number; y: number };

export function classifyHand(landmarks: Point[]): GesturePose {
  if (landmarks.length < 21) return "none";
  const wrist = landmarks[0];
  const tips = [8, 12, 16, 20];
  const pips = [6, 10, 14, 18];
  const extended = tips.map((tip, index) => {
    const tipDistance = Math.hypot(landmarks[tip].x - wrist.x, landmarks[tip].y - wrist.y);
    const pipDistance = Math.hypot(landmarks[pips[index]].x - wrist.x, landmarks[pips[index]].y - wrist.y);
    return tipDistance > pipDistance * 1.18;
  });
  if (extended.every(Boolean)) return "palm";
  if (extended[0] && extended.slice(1).every((value) => !value)) return "point";
  if (extended.every((value) => !value)) return "fist";
  return "other";
}

function clampPoint(point: GesturePoint): GesturePoint {
  return { x: Math.min(1, Math.max(0, point.x)), y: Math.min(1, Math.max(0, point.y)) };
}

function normalizeRegion(a: GesturePoint, b: GesturePoint): NormalizedRegion {
  return { left: Math.min(a.x, b.x), top: Math.min(a.y, b.y), right: Math.max(a.x, b.x), bottom: Math.max(a.y, b.y) };
}

function regionIsLargeEnough(rect: NormalizedRegion) {
  return rect.right - rect.left >= 0.025 && rect.bottom - rect.top >= 0.025;
}
