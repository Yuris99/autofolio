import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { ROOT } from "../config.js";
import type { Profile } from "./schema.js";

export const PROFILE_PATH = path.join(ROOT, "data", "profile.yaml");
export const PROFILE_EXAMPLE_PATH = path.join(ROOT, "profile.example.yaml");

export function loadProfile(file = PROFILE_PATH): Profile {
  if (!existsSync(file)) {
    throw new Error(
      `프로필 파일이 없습니다: ${path.relative(ROOT, file)}\n` +
        `  cp profile.example.yaml data/profile.yaml 후 실제 이력으로 채워주세요.`,
    );
  }
  return (parse(readFileSync(file, "utf8")) ?? {}) as Profile;
}
