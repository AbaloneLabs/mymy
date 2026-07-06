import type { NativeSkill, SkillBundle } from "@/features/skills/api";

export type SlashOption = {
  type: "bundle" | "skill";
  name: string;
  description: string;
  skills: string[];
};

export function parseSlashState(text: string) {
  const rest = text.trimStart();
  if (!rest.startsWith("/")) return null;
  const body = rest.slice(1);
  const commandEnd = body.search(/\s/);
  const command = commandEnd >= 0 ? body.slice(0, commandEnd) : body;
  return {
    command,
    query: slugify(command),
    hasInstruction: commandEnd >= 0,
  };
}

export function buildSlashOptions(
  bundles: SkillBundle[],
  skills: NativeSkill[],
  query: string,
): SlashOption[] {
  const options: SlashOption[] = [
    ...bundles.map((bundle) => ({
      type: "bundle" as const,
      name: bundle.name,
      description: bundle.description,
      skills: bundle.skills,
    })),
    ...skills.map((skill) => ({
      type: "skill" as const,
      name: skill.name,
      description: skill.description,
      skills: [],
    })),
  ];
  return options
    .filter((option) => {
      if (!query) return true;
      return slugify(option.name).includes(query);
    })
    .slice(0, 6);
}

export function findExactSlashOption(
  bundles: SkillBundle[],
  skills: NativeSkill[],
  command: string,
): SlashOption | null {
  if (!command) return null;
  const query = slugify(command);
  return (
    buildSlashOptions(bundles, skills, "")
      .find((option) => slugify(option.name) === query) ?? null
  );
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._\-\s/]+/g, "")
    .trim()
    .replace(/[\s/_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}
