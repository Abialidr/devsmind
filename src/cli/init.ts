import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import prompts from 'prompts';
import * as dotenv from 'dotenv';
import { DevMindDatabase } from '../db/database';
import {
  DevMindConfig,
  RepoConfig,
  EmbeddedRepoConfig,
  StandaloneRepoConfig,
  TechStack
} from '../utils/config';

// ─── Detection Helpers ─────────────────────────────────────────────────────

/** Read a global git config value (user.name, user.email, etc.) */
function readGitConfig(key: string): string {
  try {
    return execSync(`git config ${key}`, { encoding: 'utf-8' }).trim();
  } catch {
    return '';
  }
}

/** Parse non-comment, non-empty lines from a .gitignore file */
function readGitIgnorePatterns(dir: string): string[] {
  const gitignorePath = path.join(dir, '.gitignore');
  if (!fs.existsSync(gitignorePath)) return [];
  return fs.readFileSync(gitignorePath, 'utf-8')
    .split('\n')
    .map((l: string) => l.trim())
    .filter((l: string) => l && !l.startsWith('#'));
}

/** Detect tech stack from package.json and project indicator files */
function detectTechStack(repoPaths: string[]): TechStack {
  const frameworks = new Set<string>();
  const languages = new Set<string>();

  for (const repoPath of repoPaths) {
    if (!fs.existsSync(repoPath)) continue;

    // Language detection from indicator files
    if (fs.existsSync(path.join(repoPath, 'tsconfig.json'))) languages.add('typescript');
    if (fs.existsSync(path.join(repoPath, 'go.mod'))) languages.add('go');
    if (fs.existsSync(path.join(repoPath, 'pom.xml'))) languages.add('java');
    if (fs.existsSync(path.join(repoPath, 'Cargo.toml'))) languages.add('rust');
    if (
      fs.existsSync(path.join(repoPath, 'requirements.txt')) ||
      fs.existsSync(path.join(repoPath, 'pyproject.toml'))
    ) languages.add('python');

    // Framework + language detection from package.json
    const pkgPath = path.join(repoPath, 'package.json');
    if (fs.existsSync(pkgPath)) {
      if (!languages.has('typescript')) languages.add('javascript');
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        const deps: Record<string, string> = { ...pkg.dependencies, ...pkg.devDependencies };
        if (deps['@nestjs/core']) frameworks.add('nestjs');
        if (deps['express']) frameworks.add('express');
        if (deps['next']) frameworks.add('nextjs');
        if (deps['react'] && !deps['next']) frameworks.add('react');
        if (deps['vue']) frameworks.add('vue');
        if (deps['fastify']) frameworks.add('fastify');
        if (deps['@angular/core']) frameworks.add('angular');
        if (deps['svelte']) frameworks.add('svelte');
        if (deps['hono']) frameworks.add('hono');
        if (deps['koa']) frameworks.add('koa');
        if (deps['prisma'] || deps['@prisma/client']) frameworks.add('prisma');
        if (deps['typeorm']) frameworks.add('typeorm');
        if (deps['mongoose']) frameworks.add('mongoose');
      } catch { /* skip malformed package.json */ }
    }
  }

  return {
    languages: [...languages],
    frameworks: [...frameworks]
  };
}

/** Aggregate unique ignored patterns from multiple repo paths */
function aggregateIgnoredPaths(repoPaths: string[]): string[] {
  const all = repoPaths.flatMap(p => readGitIgnorePatterns(p));
  return [...new Set(all)];
}

function ensureDbInitialized(dbPath: string) {
  const db = new DevMindDatabase(dbPath);
  db.close();
}

function scanSubdirectories(dir: string): string[] {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    return entries
      .filter(entry => entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules')
      .map(entry => entry.name);
  } catch {
    return [];
  }
}

// ─── Entry Point ───────────────────────────────────────────────────────────

export async function handleInit() {
  const cwd = process.cwd();
  const devmindDir = path.join(cwd, '.devmind');
  const configPath = path.join(devmindDir, 'config.json');
  const envPath = path.join(devmindDir, '.env');
  const dbPath = path.join(devmindDir, 'brain.db');

  console.log(`🤖 Initializing DevsMind in: ${cwd}`);

  if (fs.existsSync(devmindDir) && fs.existsSync(configPath)) {
    console.log(`✨ Found existing DevsMind configuration at ${configPath}`);
    await handleExistingInit(devmindDir, configPath, envPath, dbPath);
  } else {
    console.log(`🆕 Creating a new DevsMind brain...`);
    await handleNewInit(cwd);
  }
}

// ─── Re-Init ───────────────────────────────────────────────────────────────

async function handleExistingInit(
  devmindDir: string,
  configPath: string,
  envPath: string,
  dbPath: string
) {
  const configContent = fs.readFileSync(configPath, 'utf-8');
  let config: DevMindConfig;
  try {
    config = JSON.parse(configContent) as DevMindConfig;
  } catch (err) {
    console.error(`❌ Error parsing config.json: ${(err as Error).message}`);
    return;
  }

  let envConfig: Record<string, string> = {};
  if (fs.existsSync(envPath)) {
    envConfig = dotenv.parse(fs.readFileSync(envPath, 'utf-8'));
  }

  const envLines: string[] = [];

  // ── Developer info check (all modes) ─────────────────────────
  const missingDev = !envConfig['DEVELOPER_NAME'] || !envConfig['DEVELOPER_EMAIL'];
  if (missingDev) {
    console.log(`\n👤 Developer info missing from .env:`);
    const detectedName = readGitConfig('user.name');
    const detectedEmail = readGitConfig('user.email');

    const devResponse = await prompts([
      {
        type: 'text',
        name: 'name',
        message: 'Your name?',
        initial: detectedName,
        validate: (v: string) => v.trim() ? true : 'Developer name is required'
      },
      {
        type: 'text',
        name: 'email',
        message: 'Your email?',
        initial: detectedEmail,
        validate: (v: string) => v.trim() ? true : 'Developer email is required'
      }
    ]);

    if (!devResponse.name) {
      console.log('❌ Initialization cancelled.');
      return;
    }

    envLines.push(`DEVELOPER_NAME=${devResponse.name.trim()}`);
    envLines.push(`DEVELOPER_EMAIL=${devResponse.email?.trim() || ''}`);
  } else {
    envLines.push(`DEVELOPER_NAME=${envConfig['DEVELOPER_NAME']}`);
    envLines.push(`DEVELOPER_EMAIL=${envConfig['DEVELOPER_EMAIL']}`);
  }

  // ── Mode-specific path validation ────────────────────────────
  if (config.mode === 'embedded') {
    console.log(`📦 Embedded mode — verifying relative repository paths...`);
    const projectRoot = path.dirname(devmindDir);
    let allOk = true;

    for (const repo of config.repos) {
      if ('relative_path' in repo) {
        const embeddedRepo = repo as EmbeddedRepoConfig;
        const fullPath = path.resolve(projectRoot, embeddedRepo.relative_path);
        if (!fs.existsSync(fullPath)) {
          console.warn(`⚠️  Repo "${repo.name}" not found at relative path: ${embeddedRepo.relative_path}`);
          allOk = false;
        } else {
          console.log(`✅ Repo "${repo.name}" OK (${embeddedRepo.relative_path})`);
        }
      }
    }

    if (allOk) console.log(`✅ All relative paths are valid.`);
  } else {
    console.log(`🌐 Standalone mode — checking repository paths in .env...`);

    const missingKeys: RepoConfig[] = [];
    const invalidPaths: { repo: RepoConfig; currentPath: string }[] = [];

    for (const repo of config.repos) {
      if ('path_key' in repo && repo.path_key) {
        const currentPath = envConfig[repo.path_key];
        if (!currentPath) {
          missingKeys.push(repo);
        } else if (!fs.existsSync(path.resolve(currentPath))) {
          invalidPaths.push({ repo, currentPath });
        } else {
          envLines.push(`${repo.path_key}=${currentPath}`);
        }
      }
    }

    // Keep unaffected existing keys (not repo paths, not dev info)
    for (const [key, value] of Object.entries(envConfig)) {
      const isRepoPath = config.repos.some(r => 'path_key' in r && r.path_key === key);
      const isDevKey = key === 'DEVELOPER_NAME' || key === 'DEVELOPER_EMAIL';
      if (!isRepoPath && !isDevKey) {
        envLines.push(`${key}=${value}`);
      }
    }

    if (missingKeys.length === 0 && invalidPaths.length === 0) {
      console.log(`✅ All repo paths are configured and valid.`);
    } else {
      console.log(`📝 Please configure paths for your repositories on this machine:`);
      const reposToPrompt = [...missingKeys, ...invalidPaths.map(ip => ip.repo)];

      for (const repo of reposToPrompt) {
        if ('path_key' in repo && repo.path_key) {
          const initialPath = envConfig[repo.path_key] || process.cwd();
          const response = await prompts({
            type: 'text',
            name: 'localPath',
            message: `Local path for repo "${repo.name}" (${repo.path_key})?`,
            initial: initialPath,
            validate: (val: string) => {
              const resolved = path.resolve(val);
              return fs.existsSync(resolved) ? true : `Directory does not exist: ${resolved}`;
            }
          });

          if (response.localPath === undefined) {
            console.log('❌ Initialization cancelled.');
            return;
          }

          envLines.push(`${repo.path_key}=${path.resolve(response.localPath)}`);
        }
      }
    }
  }

  // Write updated .env
  fs.writeFileSync(envPath, envLines.join('\n') + '\n', 'utf-8');
  console.log(`💾 Updated ${envPath}`);

  // Ensure .gitignore exists
  const gitignorePath = path.join(devmindDir, '.gitignore');
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, '.env\n', 'utf-8');
  }

  ensureDbInitialized(dbPath);
  console.log(`🎉 DevsMind initialization complete!`);
}

// ─── New Init ──────────────────────────────────────────────────────────────

async function handleNewInit(cwd: string) {
  const defaultProjectName = path.basename(cwd);

  // ── Step 1: Project name + mode ──────────────────────────────
  const baseResponse = await prompts([
    {
      type: 'text',
      name: 'projectName',
      message: 'Project name?',
      initial: defaultProjectName
    },
    {
      type: 'select',
      name: 'mode',
      message: 'Select the setup mode for this brain:',
      choices: [
        {
          title: 'Embedded (Single Git repo)',
          value: 'embedded',
          description: 'Lives inside the project repo. Relative paths — clone once, works everywhere.'
        },
        {
          title: 'Standalone (Multiple separate Git repos)',
          value: 'standalone',
          description: 'Its own folder/repo. Repo names shared via config; local paths in .env.'
        }
      ],
      initial: 0
    }
  ]);

  if (baseResponse.projectName === undefined || baseResponse.mode === undefined) {
    console.log('❌ Initialization cancelled.');
    return;
  }

  // ── Step 2: Resolve target directory ─────────────────────────
  let targetDir = '';
  let devmindDir = '';

  if (baseResponse.mode === 'embedded') {
    targetDir = cwd;
    devmindDir = path.join(targetDir, '.devmind');
  } else {
    const defaultFolderName = `${baseResponse.projectName.toLowerCase().replace(/[^a-z0-9]/g, '-')}-brain`;

    const folderResponse = await prompts([
      {
        type: 'text',
        name: 'folderName',
        message: "Brain's folder name?",
        initial: defaultFolderName
      },
      {
        type: 'text',
        name: 'folderParent',
        message: 'Where do you want it to live?',
        initial: cwd,
        validate: (val: string) => {
          const resolved = path.resolve(val);
          return fs.existsSync(resolved) ? true : `Directory does not exist: ${resolved}`;
        }
      }
    ]);

    if (folderResponse.folderName === undefined || folderResponse.folderParent === undefined) {
      console.log('❌ Initialization cancelled.');
      return;
    }

    targetDir = path.join(path.resolve(folderResponse.folderParent), folderResponse.folderName);
    devmindDir = path.join(targetDir, '.devmind');

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
      console.log(`📁 Created folder: ${targetDir}`);
    }
  }

  const configPath = path.join(devmindDir, 'config.json');
  const envPath = path.join(devmindDir, '.env');
  const dbPath = path.join(devmindDir, 'brain.db');

  const repos: RepoConfig[] = [];
  const envLines: string[] = [];
  const repoPaths: string[] = []; // Track actual FS paths for detection

  // ── Step 3: Configure repos ───────────────────────────────────
  if (baseResponse.mode === 'embedded') {
    console.log(`\n🔍 Scanning for repositories in current folder...`);
    const subdirs = scanSubdirectories(cwd);

    const choices = [
      { title: `Root Directory (./)`, value: '.' },
      ...subdirs.map(dir => ({ title: `Subdirectory: ${dir} (./${dir})`, value: dir }))
    ];

    const repoSelection = await prompts({
      type: 'multiselect',
      name: 'selectedDirs',
      message: 'Select which directories are part of this project:',
      choices,
      min: 1,
      hint: '- Space to select. Return to submit.'
    });

    if (repoSelection.selectedDirs === undefined) {
      console.log('❌ Initialization cancelled.');
      return;
    }

    for (const dir of repoSelection.selectedDirs) {
      const repoName = dir === '.' ? baseResponse.projectName : dir;
      const relativePath = dir === '.' ? '.' : `./${dir}`;
      repos.push({ name: repoName, relative_path: relativePath } as EmbeddedRepoConfig);
      repoPaths.push(path.resolve(cwd, relativePath));
    }
  } else {
    const countResponse = await prompts({
      type: 'number',
      name: 'repoCount',
      message: 'How many separate repositories does this brain serve?',
      initial: 1,
      min: 1
    });

    if (countResponse.repoCount === undefined) {
      console.log('❌ Initialization cancelled.');
      return;
    }

    for (let i = 0; i < countResponse.repoCount; i++) {
      console.log(`\n📦 Configuring Repository ${i + 1} of ${countResponse.repoCount}:`);
      const defaultName = countResponse.repoCount === 1 ? baseResponse.projectName : `service-${i + 1}`;

      const repoResponse = await prompts([
        {
          type: 'text',
          name: 'name',
          message: 'Repository name?',
          initial: defaultName
        },
        {
          type: 'text',
          name: 'localPath',
          message: 'Local absolute path to this repository?',
          initial: cwd,
          validate: (val: string) => {
            const resolved = path.resolve(val);
            return fs.existsSync(resolved) ? true : `Directory does not exist: ${resolved}`;
          }
        }
      ]);

      if (repoResponse.name === undefined || repoResponse.localPath === undefined) {
        console.log('❌ Initialization cancelled.');
        return;
      }

      const pathKey = `REPO_${repoResponse.name.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
      repos.push({ name: repoResponse.name, path_key: pathKey } as StandaloneRepoConfig);
      envLines.push(`${pathKey}=${path.resolve(repoResponse.localPath)}`);
      repoPaths.push(path.resolve(repoResponse.localPath));
    }
  }

  // ── Step 4: Developer info (mandatory) ───────────────────────
  console.log(`\n👤 Developer info (stored in .env, gitignored — per developer):`);
  const detectedName = readGitConfig('user.name');
  const detectedEmail = readGitConfig('user.email');

  const devResponse = await prompts([
    {
      type: 'text',
      name: 'name',
      message: 'Your name?',
      initial: detectedName,
      validate: (v: string) => v.trim() ? true : 'Developer name is required'
    },
    {
      type: 'text',
      name: 'email',
      message: 'Your email?',
      initial: detectedEmail,
      validate: (v: string) => v.trim() ? true : 'Developer email is required'
    }
  ]);

  if (!devResponse.name) {
    console.log('❌ Initialization cancelled.');
    return;
  }

  envLines.push(`DEVELOPER_NAME=${devResponse.name.trim()}`);
  envLines.push(`DEVELOPER_EMAIL=${devResponse.email?.trim() || ''}`);

  // ── Step 5: Ignored paths (auto from .gitignore) ──────────────
  let ignoredPaths: string[] = [];
  const detectedIgnored = aggregateIgnoredPaths(repoPaths);

  if (detectedIgnored.length > 0) {
    const preview = detectedIgnored.slice(0, 6).join(', ') + (detectedIgnored.length > 6 ? ', ...' : '');
    console.log(`\n🚫 Auto-detected ${detectedIgnored.length} ignored paths from .gitignore files.`);
    console.log(`   Default: ${preview}`);

    const ignoreResponse = await prompts({
      type: 'confirm',
      name: 'useDetected',
      message: 'Use these as ignored_paths?',
      initial: true
    });

    if (ignoreResponse.useDetected) {
      ignoredPaths = detectedIgnored;
    } else {
      const customResponse = await prompts({
        type: 'list',
        name: 'paths',
        message: 'Custom ignored paths? (comma separated)',
        initial: detectedIgnored.join(', '),
        separator: ','
      });
      ignoredPaths = (customResponse.paths || []).map((p: string) => p.trim()).filter(Boolean);
    }
  } else {
    const customResponse = await prompts({
      type: 'text',
      name: 'paths',
      message: 'No .gitignore found. Ignored paths? (comma separated, leave empty to skip)',
    });
    if (customResponse.paths?.trim()) {
      ignoredPaths = customResponse.paths.split(',').map((p: string) => p.trim()).filter(Boolean);
    }
  }

  // ── Step 6: Tech stack (auto from package.json) ───────────────
  let techStack: TechStack | undefined;
  const detected = detectTechStack(repoPaths);
  const hasDetected = (detected.languages?.length ?? 0) > 0 || (detected.frameworks?.length ?? 0) > 0;

  if (hasDetected) {
    console.log(`\n🛠️  Auto-detected tech stack:`);
    if (detected.languages?.length) console.log(`   Languages:  ${detected.languages.join(', ')}`);
    if (detected.frameworks?.length) console.log(`   Frameworks: ${detected.frameworks.join(', ')}`);

    const techConfirm = await prompts({
      type: 'confirm',
      name: 'correct',
      message: 'Does this look right?',
      initial: true
    });

    if (techConfirm.correct) {
      techStack = detected;
    } else {
      const techManual = await prompts([
        {
          type: 'list',
          name: 'languages',
          message: 'Languages? (comma separated)',
          initial: detected.languages?.join(', ') || '',
          separator: ','
        },
        {
          type: 'list',
          name: 'frameworks',
          message: 'Frameworks? (comma separated)',
          initial: detected.frameworks?.join(', ') || '',
          separator: ','
        }
      ]);
      techStack = {
        languages: (techManual.languages || []).map((l: string) => l.trim()).filter(Boolean),
        frameworks: (techManual.frameworks || []).map((f: string) => f.trim()).filter(Boolean)
      };
    }
  }

  // ── Step 7: Session timeout (optional, default 60) ────────────
  const timeoutResponse = await prompts({
    type: 'number',
    name: 'minutes',
    message: 'Session timeout in minutes? (default: 60 — press Enter to keep)',
    initial: 60,
    min: 5
  });
  const sessionTimeout: number = timeoutResponse.minutes ?? 60;

  // ── Step 8: Environments (optional) ───────────────────────────
  let environments: Record<string, string> | undefined;
  const addEnvs = await prompts({
    type: 'confirm',
    name: 'add',
    message: 'Add environment URLs? (dev, staging, prod) [optional]',
    initial: false
  });

  if (addEnvs.add) {
    environments = {};
    for (const envName of ['dev', 'staging', 'prod']) {
      const urlResponse = await prompts({
        type: 'text',
        name: 'url',
        message: `${envName} URL? (leave empty to skip)`
      });
      if (urlResponse.url?.trim()) {
        environments[envName] = urlResponse.url.trim();
      }
    }
    if (Object.keys(environments).length === 0) environments = undefined;
  }

  // ── Step 9: Notes (optional) ──────────────────────────────────
  const notesResponse = await prompts({
    type: 'text',
    name: 'notes',
    message: 'Any notes for the AI about this project? (optional)'
  });

  // ── Write files ───────────────────────────────────────────────
  if (!fs.existsSync(devmindDir)) {
    fs.mkdirSync(devmindDir, { recursive: true });
  }

  const config: DevMindConfig = {
    project_name: baseResponse.projectName,
    mode: baseResponse.mode,
    notes: notesResponse.notes || undefined,
    session_timeout_minutes: sessionTimeout !== 60 ? sessionTimeout : undefined,
    ignored_paths: ignoredPaths.length > 0 ? ignoredPaths : undefined,
    tech_stack: techStack,
    environments,
    repos
  };

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  console.log(`\n💾 Created ${configPath} (safe to commit to Git)`);

  // Always write .env — developer info is always local
  fs.writeFileSync(envPath, envLines.join('\n') + '\n', 'utf-8');
  console.log(`💾 Created ${envPath} (local, gitignored)`);

  // Always create .gitignore to protect .env
  const gitignorePath = path.join(devmindDir, '.gitignore');
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, '.env\n', 'utf-8');
    console.log(`💾 Created ${gitignorePath}`);
  }

  ensureDbInitialized(dbPath);
  console.log(`🗄️  Initialized SQLite database at ${dbPath}`);

  console.log(`\n🎉 DevsMind Team AI Brain setup successfully completed!`);
  if (baseResponse.mode === 'standalone') {
    console.log(`💡 Next step: set DEVMIND_PATH = ${devmindDir} in your AI workspace rule.`);
  } else {
    console.log(`💡 Next step: run 'devsmind start' to launch the MCP server.`);
  }
}
