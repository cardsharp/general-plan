import "dotenv/config";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

function parseArgs(raw: string) {
  return raw
    .split(" ")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function run() {
  const command = process.env.YOUTUBE_MCP_COMMAND;
  const args = parseArgs(process.env.YOUTUBE_MCP_ARGS || "");

  if (!command) {
    throw new Error("Set YOUTUBE_MCP_COMMAND in .env (and optionally YOUTUBE_MCP_ARGS). Example: YOUTUBE_MCP_COMMAND=npx");
  }

  const transport = new StdioClientTransport({
    command,
    args,
    stderr: "pipe",
  });

  const client = new Client({ name: "fh-plan-youtube-tools", version: "0.1.0" }, { capabilities: {} });

  await client.connect(transport);
  const result = await client.listTools();

  console.log("MCP tools discovered:\n");
  for (const tool of result.tools) {
    console.log(`- ${tool.name}`);
    if (tool.description) console.log(`  ${tool.description}`);
    if (tool.inputSchema) console.log(`  inputSchema: ${JSON.stringify(tool.inputSchema)}`);
    console.log("");
  }

  await transport.close();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
