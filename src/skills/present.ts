import Skill from "../core/skill.js";
import { PresentTools } from "../tools/present/index.js";
import { BashTools } from "../tools/bash/index.js";
import { FsListDirTool, FsDeleteTool, FsStatTool } from "../tools/fs/index.js";

export const PresentSkill = () => new Skill({
    name: "present",
    description: "Use this skill whenever a job produces output the user should receive as files — code, documents, generated assets, a small script, or an entire project. Covers deciding whether to present files individually or as a single zip, and cleaning up build/dependency artifacts (node_modules, build/dist output, caches, lockfiles' junk, etc.) before zipping so the archive only contains what the user actually needs. Trigger this at the point a task is otherwise complete and its output is ready to hand back.",
    tools: [
        ...PresentTools(),
        ...BashTools(),
        FsListDirTool(),
        FsDeleteTool(),
        FsStatTool(),
    ],
    instructions: `
# Present Skill

## Purpose
Once a job is actually done, the output still has to reach the user in a form they can use. This skill governs that last step: deciding whether to present files one by one or as a single archive, and — for anything project-sized — making sure the archive doesn't ship junk (dependencies, build output, caches) that the user never asked for and shouldn't have to download.

## Decide: few files vs. a project
- **A handful of files** (a script, a couple of generated documents, a small number of clearly-related outputs): present them individually with present-add, one call per file. Don't zip small, simple results — that just adds friction for the user (an extra unzip step) for no benefit.
- **A project or anything with many files / a directory tree** (a scaffolded app, a multi-file codebase, a folder of generated assets): zip the whole thing into a single archive and present that one zip instead of dozens of present-add calls. Many small files are hard to review individually and easy to lose track of; one archive is not.
- When unsure whether something counts as "a few files" or "a project," lean on file count and structure: a flat handful of standalone files → present individually. Anything with subdirectories, or more than ~6-8 files, or an identifiable "project root" (has a package.json, requirements.txt, .git, src/ folder, etc.) → treat it as a project and zip it.

## Before zipping a project: clean it up first
Never zip a project as-is without checking for artifacts that don't belong in the archive. Before creating the zip:
1. **Inspect the project root** with fs-list-dir (recursive) to see what's actually in there.
2. **Identify and remove anything that is regenerable or environment-specific rather than actual project output**, for example:
   - Dependency folders: \`node_modules\`, \`vendor\`, Python \`venv\`/\`.venv\`, \`__pycache__\`
   - Build/compile output that the user didn't specifically ask to receive: \`dist\`, \`build\`, \`.next\`, \`target\`, \`out\`, compiled \`.class\`/\`.o\`/\`.pyc\` files
   - Caches and local tooling state: \`.cache\`, \`.turbo\`, \`.parcel-cache\`, \`.DS_Store\`, editor folders like \`.vscode\`/\`.idea\` unless the user asked for editor config specifically
   - VCS internals the user has no use for in a delivered zip: \`.git\` (unless the user explicitly wants git history)
   - Log files and temp files generated during the work itself (\`*.log\`, \`tmp/\`, \`.tmp\`)
3. **Use fs-delete (recursive where needed) or bash-run** to remove these before archiving. Removing node_modules in particular is usually the single biggest size reduction — dependencies are meant to be reinstalled (\`npm install\`, \`pip install -r requirements.txt\`, etc.), not shipped.
4. **Keep anything that's actual project output or source**: source code, configuration the project needs to run (package.json, requirements.txt, tsconfig.json, Dockerfiles, etc.), README/docs, and any files the user specifically asked to see the build/output of.
5. If genuinely unsure whether something is safe to remove (e.g. a folder whose purpose isn't obvious from its name), check what it is (fs-stat, fs-list-dir into it) before deleting rather than deleting blindly.

## Zipping
- Use bash-run to invoke the system zip utility (e.g. \`zip -r project.zip .\` from inside the project root, or \`tar -czf project.tar.gz .\` if zip isn't relevant to the context) after cleanup is done, not before.
- Zip from a location where the archive's internal paths make sense when extracted (typically zip the project folder's *contents* so extracting doesn't require the user to dig through a redundant wrapper folder, unless a single top-level folder is expected/desired).
- After zipping, present-add only the resulting archive file — never present-add every individual file of a project once it's been zipped; that defeats the purpose.

## Presenting
- present-add requires a single file path — it will reject a directory. This is exactly why projects get zipped first: it's not optional plumbing, it's the mechanism for handing back a whole folder as one deliverable.
- If present-add is called multiple times across a session and some of those earlier presents are now stale/superseded (e.g. you're re-zipping after a fix), use present-clear first so the user doesn't end up with old and new versions both listed.
- Use present-get-list if you need to confirm what's currently presented before deciding whether to clear or add more.

## What this does NOT mean
- Don't zip trivial output just to have "one file" — a single script or a couple of standalone documents should still be presented individually; zipping one file adds an unzip step for no reason.
- Don't delete anything you're not confident is regenerable/unnecessary. When a folder's purpose is ambiguous, inspect it rather than guessing — an overzealous cleanup that removes something the user actually wanted is worse than a slightly larger zip.
- Cleanup is about removing artifacts that don't belong in a delivered archive, not about editing or "improving" the user's actual project files — don't modify source/content as part of this skill's cleanup step.
`
});

export default PresentSkill;