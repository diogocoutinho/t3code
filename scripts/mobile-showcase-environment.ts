// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalDate:off - This host-side fixture creates an isolated local T3 environment.
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import * as NodeUtil from "node:util";

const execFile = NodeUtil.promisify(NodeChildProcess.execFile);

const SHOWCASE_PROJECT_ID = "t3code";
const SHOWCASE_THREAD_ID = "remote-command-center";

export const SHOWCASE_SCENES = [
  "threads",
  "thread",
  "terminal",
  "review",
  "environments",
  "agent-activity",
] as const;
export type ShowcaseScene = (typeof SHOWCASE_SCENES)[number];

const MODEL_SELECTION = JSON.stringify({ instanceId: "codex", model: "gpt-5.4" });
const PROJECT_SCRIPTS = JSON.stringify([
  {
    id: "dev",
    name: "Dev",
    command: "pnpm dev",
    icon: "play",
    runOnWorktreeCreate: false,
  },
  {
    id: "test",
    name: "Testes",
    command: "pnpm test",
    icon: "test",
    runOnWorktreeCreate: false,
  },
]);

const SHOWCASE_TERMINAL_PROMPT =
  "\u001b[1;32m→\u001b[0m \u001b[1;36mloja-online\u001b[0m \u001b[1;34mgit:(\u001b[1;31mfeat/checkout-rapido\u001b[1;34m)\u001b[0m \u001b[1;33m✗\u001b[0m ";

const SHOWCASE_TERMINAL_BUFFER = [
  `${SHOWCASE_TERMINAL_PROMPT}pnpm dev`,
  "",
  "  \u001b[1;32mVITE\u001b[0m \u001b[32mv7.1.1\u001b[0m  \u001b[2mready in\u001b[0m \u001b[1m1.24s\u001b[0m",
  "",
  "  \u001b[32m→\u001b[0m  \u001b[2mLocal:\u001b[0m    \u001b[4;36mhttp://127.0.0.1:5173/\u001b[0m",
  "  \u001b[32m→\u001b[0m  \u001b[2mNetwork:\u001b[0m  \u001b[4;36mhttp://192.168.1.24:5173/\u001b[0m",
  "  \u001b[32m→\u001b[0m  \u001b[2mProject:\u001b[0m  \u001b[1mloja-online\u001b[0m \u001b[2m(~/projetos/loja-online)\u001b[0m",
  "",
  "  \u001b[32m✓ 612 passed\u001b[0m   \u001b[33m△ 2 warnings\u001b[0m   \u001b[31m✗ 0 failed\u001b[0m",
  "",
  "  \u001b[42;30m READY \u001b[0m \u001b[2mwatching for changes, press\u001b[0m \u001b[1mq\u001b[0m \u001b[2mto quit\u001b[0m",
  "",
  SHOWCASE_TERMINAL_PROMPT,
].join("\r\n");

const BASE_CART_SUMMARY = `export function resumoDoCarrinho(itens: number): string {
  return \`${"${itens}"} itens no carrinho\`;
}
`;

const UPDATED_CART_SUMMARY = `const MOEDA = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function resumoDoCarrinho(itens: number, total: number, desconto: number): string {
  const valor = MOEDA.format(total - desconto);
  return \`${"${itens}"} itens · ${"${valor}"}\`;
}
`;

const COUPON_CARD = `import { View, Text } from "react-native";

export function CupomAplicado(props: { codigo: string; economia: string }) {
  return (
    <View className="rounded-2xl bg-surface-2 p-4">
      <Text className="font-semibold">Cupom {props.codigo} aplicado</Text>
      <Text className="text-success">Você economizou {props.economia}</Text>
    </View>
  );
}
`;

function monogramFavicon(letter: string, background: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="15" fill="${background}"/>
  <text x="32" y="43" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="32" font-weight="700" fill="#fff">${letter}</text>
</svg>`;
}

const PROJECT_FAVICONS = {
  t3code: monogramFavicon("L", "#e2572b"),
  react: monogramFavicon("A", "#2f7de1"),
  linux: monogramFavicon("P", "#1f9d6b"),
} as const;

export const SHOWCASE_PROJECTS = [
  {
    id: "t3code",
    title: "loja-online",
    directory: "loja-online",
    repositoryUrl: "https://git.example.com/equipe/loja-online.git",
    favicon: PROJECT_FAVICONS.t3code,
  },
  {
    id: "react",
    title: "app-agenda",
    directory: "app-agenda",
    repositoryUrl: "https://git.example.com/equipe/app-agenda.git",
    favicon: PROJECT_FAVICONS.react,
  },
  {
    id: "linux",
    title: "api-pagamentos",
    directory: "api-pagamentos",
    repositoryUrl: "https://git.example.com/equipe/api-pagamentos.git",
    favicon: PROJECT_FAVICONS.linux,
  },
] as const;

// The labels key the display URLs in apps/mobile/src/features/showcase/showcaseEnvironmentRows.ts.
export const SHOWCASE_ENVIRONMENTS = [
  {
    id: "moonbase-terminal",
    label: "Servidor",
    projectIds: ["t3code"],
  },
  {
    id: "suspense-station",
    label: "MacBook",
    projectIds: ["react"],
  },
  {
    id: "kernel-cabin",
    label: "Notebook",
    projectIds: ["linux"],
  },
] as const;

export const SHOWCASE_THREADS = [
  {
    id: SHOWCASE_THREAD_ID,
    projectId: "t3code",
    title: "Checkout em uma tela só ✦",
    branch: "feat/checkout-rapido",
    minutesAgo: 3,
    request:
      "Simplifique o checkout da loja: carrinho, frete e pagamento numa tela só, com o cupom aplicado na hora e sem perder o carrinho se a conexão cair.",
    response:
      "O checkout agora cabe numa tela só. ✦\n\n- Carrinho, frete e pagamento ficam visíveis juntos\n- O cupom é validado e aplicado na hora\n- O carrinho fica salvo no aparelho e sobrevive a quedas de conexão\n- O resumo mostra o total atualizado a cada alteração\n\nTambém rodei a suíte do projeto: **612 testes passaram**.",
  },
  {
    id: "pocket-command-center",
    projectId: "t3code",
    title: "Pix com QR Code no checkout",
    branch: "feat/pix-checkout",
    minutesAgo: 21,
    state: "approval" as const,
    request:
      "Adicione pagamento por Pix com QR Code e confirmação automática quando o pagamento cair.",
    response:
      "O QR Code é gerado junto com o pedido e a confirmação chega pelo webhook do banco. Falta aprovar a migração da tabela de pedidos.",
  },
  {
    id: "buttery-suspense",
    projectId: "react",
    title: "Lembretes de consulta por notificação",
    branch: "feat/lembretes",
    minutesAgo: 12,
    state: "working" as const,
    request:
      "Envie um lembrete 24 horas e 1 hora antes de cada agendamento, respeitando o fuso horário do cliente.",
    response: null,
  },
  {
    id: "hydration-haikus",
    projectId: "react",
    title: "Bloquear o horário de almoço na agenda",
    branch: "feat/bloqueio-almoco",
    minutesAgo: 44,
    request:
      "Permita que cada profissional bloqueie horários fixos, como o almoço, sem criar agendamentos falsos.",
    response:
      "Cada profissional agora define intervalos recorrentes. Os horários bloqueados somem da tela de agendamento e não contam como faltas.",
    snoozeMinutes: 90,
  },
  {
    id: "beautiful-boot",
    projectId: "linux",
    title: "Planejar estornos parciais",
    branch: "feat/estornos-parciais",
    minutesAgo: 34,
    state: "plan" as const,
    request: "Planeje o suporte a estorno parcial sem quebrar a conciliação diária.",
    response:
      "O plano registra cada estorno como um lançamento próprio, mantém o saldo do pedido consistente e ajusta a conciliação sem reprocessar dias já fechados.",
  },
  {
    id: "patient-penguins",
    projectId: "linux",
    title: "Reenviar webhooks com backoff",
    branch: "feat/webhook-retry",
    minutesAgo: 52,
    request:
      "Quando o parceiro estiver fora do ar, reenvie os webhooks com intervalo crescente e sem duplicar eventos.",
    response:
      "Os webhooks agora são reenviados com backoff exponencial e chave de idempotência, então o parceiro nunca recebe o mesmo evento duas vezes.",
    snoozeMinutes: 8 * 60,
  },
  {
    id: "handoff-haptics",
    projectId: "t3code",
    title: "Fotos dos produtos em WebP",
    branch: "perf/imagens-webp",
    minutesAgo: 5 * 60,
    settled: true,
    request: "Converta as fotos dos produtos para WebP e carregue sob demanda.",
    response:
      "As fotos agora são servidas em WebP e carregadas sob demanda; a página de produto ficou 40% mais leve.",
  },
  {
    id: "streaming-shell",
    projectId: "react",
    title: "Login com código por e-mail",
    branch: "feat/login-codigo",
    minutesAgo: 28 * 60,
    settled: true,
    request: "Troque a senha por um código de 6 dígitos enviado por e-mail.",
    response:
      "O login agora envia um código de uso único, válido por 10 minutos, com limite de tentativas por endereço.",
  },
  {
    id: "quieter-oom",
    projectId: "linux",
    title: "Logs sem dados sensíveis",
    branch: "fix/logs-mascarados",
    minutesAgo: 2 * 24 * 60,
    settled: true,
    request: "Garanta que número de cartão e CPF nunca apareçam nos logs.",
    response:
      "Os logs agora mascaram cartão e CPF na origem, e um teste falha se algum campo sensível escapar.",
  },
] as const;

function minutesBefore(now: number, minutes: number): string {
  return new Date(now - minutes * 60_000).toISOString();
}

async function runGit(workspaceRoot: string, args: ReadonlyArray<string>): Promise<void> {
  await execFile("git", [...args], {
    cwd: workspaceRoot,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Alex Rivera",
      GIT_AUTHOR_EMAIL: "alex@lumen.test",
      GIT_COMMITTER_NAME: "Alex Rivera",
      GIT_COMMITTER_EMAIL: "alex@lumen.test",
    },
  });
}

async function initializeRepository(input: {
  readonly workspaceRoot: string;
  readonly repositoryUrl: string;
  readonly commitMessage: string;
}): Promise<void> {
  await runGit(input.workspaceRoot, ["init", "-b", "main"]);
  await runGit(input.workspaceRoot, ["remote", "add", "origin", input.repositoryUrl]);
  await runGit(input.workspaceRoot, ["add", "."]);
  await runGit(input.workspaceRoot, ["commit", "-m", input.commitMessage]);
}

async function seedT3CodeWorkspace(workspaceRoot: string): Promise<void> {
  await NodeFSP.mkdir(NodePath.join(workspaceRoot, "src/carrinho"), { recursive: true });
  await NodeFSP.writeFile(
    NodePath.join(workspaceRoot, "package.json"),
    `${JSON.stringify({ name: "loja-online", private: true, scripts: { test: "vitest" } }, null, 2)}\n`,
  );
  await NodeFSP.writeFile(NodePath.join(workspaceRoot, "favicon.svg"), PROJECT_FAVICONS.t3code);
  await NodeFSP.writeFile(
    NodePath.join(workspaceRoot, "src/carrinho/resumoDoCarrinho.ts"),
    BASE_CART_SUMMARY,
  );
  await initializeRepository({
    workspaceRoot,
    repositoryUrl: "https://git.example.com/equipe/loja-online.git",
    commitMessage: "Mostrar resumo do carrinho",
  });
  await runGit(workspaceRoot, ["checkout", "-b", "feat/checkout-rapido"]);
  await NodeFSP.writeFile(
    NodePath.join(workspaceRoot, "src/carrinho/resumoDoCarrinho.ts"),
    UPDATED_CART_SUMMARY,
  );
  await NodeFSP.writeFile(
    NodePath.join(workspaceRoot, "src/carrinho/CupomAplicado.tsx"),
    COUPON_CARD,
  );
}

async function seedCompanionWorkspace(input: {
  readonly workspaceRoot: string;
  readonly title: string;
  readonly repositoryUrl: string;
  readonly favicon: string;
}): Promise<void> {
  await NodeFSP.mkdir(input.workspaceRoot, { recursive: true });
  await NodeFSP.writeFile(NodePath.join(input.workspaceRoot, "favicon.svg"), input.favicon);
  await NodeFSP.writeFile(
    NodePath.join(input.workspaceRoot, "README.md"),
    `# ${input.title}\n\nCriado pelo gerador de screenshots do app.\n`,
  );
  await initializeRepository({
    workspaceRoot: input.workspaceRoot,
    repositoryUrl: input.repositoryUrl,
    commitMessage: `Criar projeto ${input.title}`,
  });
}

function insertThread(
  database: NodeSqlite.DatabaseSync,
  now: number,
  input: {
    readonly id: string;
    readonly projectId: string;
    readonly title: string;
    readonly branch: string;
    readonly minutesAgo: number;
    readonly state?: "working" | "approval" | "plan";
    readonly settled?: boolean;
    readonly snoozeMinutes?: number;
    readonly workspaceRoot: string;
  },
): void {
  const turnId = `${input.id}-turn`;
  const updatedAt = minutesBefore(now, input.minutesAgo);
  const isWorking = input.state === "working";
  const snoozedUntil =
    input.snoozeMinutes === undefined
      ? null
      : new Date(now + input.snoozeMinutes * 60_000).toISOString();
  const snoozedAt =
    input.snoozeMinutes === undefined
      ? null
      : minutesBefore(now, Math.max(1, Math.floor(input.minutesAgo / 2)));
  database
    .prepare(
      `INSERT INTO projection_threads (
        thread_id, project_id, title, model_selection_json, runtime_mode, interaction_mode,
        branch, worktree_path, latest_turn_id, latest_user_message_at, pending_approval_count,
        pending_user_input_count, has_actionable_proposed_plan, created_at, updated_at,
        archived_at, deleted_at, settled_override, settled_at, snoozed_until, snoozed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)`,
    )
    .run(
      input.id,
      input.projectId,
      input.title,
      MODEL_SELECTION,
      "full-access",
      input.state === "plan" ? "plan" : "default",
      input.branch,
      input.workspaceRoot,
      turnId,
      minutesBefore(now, input.minutesAgo + 1),
      input.state === "approval" ? 1 : 0,
      input.state === "plan" ? 1 : 0,
      minutesBefore(now, input.minutesAgo + 120),
      updatedAt,
      input.settled ? "settled" : null,
      input.settled ? updatedAt : null,
      snoozedUntil,
      snoozedAt,
    );
  database
    .prepare(
      `INSERT INTO projection_thread_sessions (
        thread_id, status, provider_name, provider_instance_id, provider_session_id,
        provider_thread_id, runtime_mode, active_turn_id, last_error, updated_at
      ) VALUES (?, ?, 'Codex', 'codex', NULL, NULL, 'full-access', ?, NULL, ?)`,
    )
    .run(input.id, isWorking ? "running" : "ready", isWorking ? turnId : null, updatedAt);
}

// V2 still owns projection_projects; upsert project rows without deleting them with V1 thread data.
const SEEDED_V1_TABLES = [
  "projection_thread_messages",
  "projection_thread_sessions",
  "projection_threads",
] as const;

const SEEDED_PROJECTION_TABLES = [...SEEDED_V1_TABLES, "projection_projects"] as const;

const SEEDED_THREAD_COLUMNS = ["snoozed_until", "snoozed_at"] as const;

function hasSeedableSchema(dbPath: string): boolean {
  let database: NodeSqlite.DatabaseSync;
  try {
    database = new NodeSqlite.DatabaseSync(dbPath, { readOnly: true });
  } catch {
    return false;
  }
  try {
    const tableCount = database
      .prepare(
        `SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name IN (${SEEDED_PROJECTION_TABLES.map(() => "?").join(", ")})`,
      )
      .get(...SEEDED_PROJECTION_TABLES) as { count: number };
    if (tableCount.count !== SEEDED_PROJECTION_TABLES.length) return false;

    const threadColumns = database.prepare("PRAGMA table_info(projection_threads)").all() as Array<{
      name: string;
    }>;
    const threadColumnNames = new Set(threadColumns.map((column) => column.name));
    return SEEDED_THREAD_COLUMNS.every((column) => threadColumnNames.has(column));
  } catch {
    return false;
  } finally {
    database.close();
  }
}

async function waitForSeedableSchema(dbPath: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (hasSeedableSchema(dbPath)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`The environment server did not migrate ${dbPath} within ${timeoutMs}ms.`);
}

function seedDatabase(
  dbPath: string,
  workspaceRoots: ReadonlyMap<string, string>,
  projects: ReadonlyArray<(typeof SHOWCASE_PROJECTS)[number]>,
  threads: ReadonlyArray<(typeof SHOWCASE_THREADS)[number]>,
  now: number,
): void {
  // The running server writes migrations/projections concurrently; wait for its lock instead of failing SQLITE_BUSY.
  const database = new NodeSqlite.DatabaseSync(dbPath, { timeout: 30_000 });
  try {
    database.exec("BEGIN IMMEDIATE");
    for (const table of SEEDED_V1_TABLES) {
      database.exec(`DELETE FROM ${table}`);
    }
    const insertProject = database.prepare(
      `INSERT OR REPLACE INTO projection_projects (
          project_id, title, workspace_root, default_model_selection_json, scripts_json,
          created_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
    );
    for (const [index, project] of projects.entries()) {
      const workspaceRoot = workspaceRoots.get(project.id);
      if (!workspaceRoot) throw new Error(`Missing workspace root for ${project.id}.`);
      const latestThreadMinutes = Math.min(
        ...threads
          .filter((thread) => thread.projectId === project.id)
          .map((thread) => thread.minutesAgo),
      );
      insertProject.run(
        project.id,
        project.title,
        workspaceRoot,
        MODEL_SELECTION,
        PROJECT_SCRIPTS,
        minutesBefore(now, 60 * 24 * (90 - index * 12)),
        minutesBefore(now, latestThreadMinutes),
      );
    }

    for (const thread of threads) {
      const workspaceRoot = workspaceRoots.get(thread.projectId);
      if (!workspaceRoot) throw new Error(`Missing workspace root for ${thread.projectId}.`);
      insertThread(database, now, {
        ...thread,
        ...("state" in thread ? { state: thread.state } : {}),
        workspaceRoot,
      });
    }

    const insertMessage = database.prepare(
      `INSERT INTO projection_thread_messages (
        message_id, thread_id, turn_id, role, text, is_streaming, attachments_json,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 0, NULL, ?, ?)`,
    );
    for (const thread of threads) {
      const turnId = `${thread.id}-turn`;
      const requestTime = minutesBefore(now, thread.minutesAgo + 5);
      insertMessage.run(
        `${thread.id}-request`,
        thread.id,
        turnId,
        "user",
        thread.request,
        requestTime,
        requestTime,
      );
      if (thread.response !== null) {
        const responseTime = minutesBefore(now, thread.minutesAgo);
        insertMessage.run(
          `${thread.id}-answer`,
          thread.id,
          turnId,
          "assistant",
          thread.response,
          responseTime,
          responseTime,
        );
      }
    }

    database.exec("COMMIT");
  } catch (error) {
    // Failed BEGIN or automatic rollback leaves no transaction; preserve the original error if rollback fails.
    try {
      database.exec("ROLLBACK");
    } catch {}
    throw error;
  } finally {
    database.close();
  }
}

export async function seedShowcaseEnvironment(input: {
  readonly baseDir: string;
  readonly projectIds?: ReadonlyArray<string>;
  readonly now?: number;
}): Promise<{ readonly dbPath: string; readonly workspaceRoot: string }> {
  const now = input.now ?? Date.now();
  const selectedProjectIds = new Set(
    input.projectIds ?? SHOWCASE_PROJECTS.map((project) => project.id),
  );
  const projects = SHOWCASE_PROJECTS.filter((project) => selectedProjectIds.has(project.id));
  if (projects.length === 0) throw new Error("At least one showcase project must be selected.");
  const threads = SHOWCASE_THREADS.filter((thread) => selectedProjectIds.has(thread.projectId));
  const workspaceBase = NodePath.join(input.baseDir, "workspace");
  const workspaceRoots = new Map(
    projects.map(
      (project) => [project.id, NodePath.join(workspaceBase, project.directory)] as const,
    ),
  );
  const primaryProject =
    projects.find((project) => project.id === SHOWCASE_PROJECT_ID) ?? projects[0];
  if (!primaryProject) throw new Error("The primary showcase workspace is not configured.");
  const workspaceRoot = workspaceRoots.get(primaryProject.id);
  if (!workspaceRoot) throw new Error("The primary showcase workspace is not configured.");
  const dbPath = NodePath.join(input.baseDir, "userdata", "statev2.sqlite");
  if (primaryProject.id === SHOWCASE_PROJECT_ID) {
    await seedT3CodeWorkspace(workspaceRoot);
  }
  await Promise.all(
    projects
      .filter((project) => project.id !== SHOWCASE_PROJECT_ID)
      .map(async (project) => {
        const projectWorkspaceRoot = workspaceRoots.get(project.id);
        if (!projectWorkspaceRoot) throw new Error(`Missing workspace root for ${project.id}.`);
        await seedCompanionWorkspace({
          workspaceRoot: projectWorkspaceRoot,
          title: project.title,
          repositoryUrl: project.repositoryUrl,
          favicon: project.favicon,
        });
      }),
  );
  // Listening precedes migration completion; wait for the schema before reseeding.
  await waitForSeedableSchema(dbPath);
  seedDatabase(dbPath, workspaceRoots, projects, threads, now);

  const terminalDirectory = NodePath.join(input.baseDir, "userdata", "logs", "terminals");
  if (selectedProjectIds.has(SHOWCASE_PROJECT_ID)) {
    const safeThreadId = Buffer.from(SHOWCASE_THREAD_ID).toString("base64url");
    await NodeFSP.mkdir(terminalDirectory, { recursive: true });
    await NodeFSP.writeFile(
      NodePath.join(terminalDirectory, `terminal_${safeThreadId}.log`),
      SHOWCASE_TERMINAL_BUFFER,
    );
  }
  return { dbPath, workspaceRoot };
}
