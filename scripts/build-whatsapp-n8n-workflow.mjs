import { readFile, writeFile } from "node:fs/promises";

const [sourcePath, outputPath] = process.argv.slice(2);

if (!sourcePath || !outputPath) {
  throw new Error(
    "Usage: node scripts/build-whatsapp-n8n-workflow.mjs <downloaded-workflow.json> <output.json>",
  );
}

const workflow = JSON.parse(await readFile(sourcePath, "utf8"));
const normalizer = await readFile(
  new URL("../docs/whatsapp-n8n-normalizer.js", import.meta.url),
  "utf8",
);

const existingTransform = workflow.nodes.find(
  (node) => node.name === "Extract WhatsApp Event",
);

if (!existingTransform) {
  throw new Error('The source workflow is missing the "Extract WhatsApp Event" node.');
}

const normalizeNode = {
  id: existingTransform.id,
  name: "Normalize WhatsApp Events",
  type: "n8n-nodes-base.code",
  typeVersion: 2,
  position: [320, 320],
  parameters: {
    mode: "runOnceForAllItems",
    jsCode: normalizer,
  },
};

const ingestNode = {
  id: "3c57f863-7585-4f14-a7c7-acde92a9d868",
  name: "Ingest into Aspects CRM",
  type: "n8n-nodes-base.httpRequest",
  typeVersion: 4.4,
  position: [640, 320],
  parameters: {
    method: "POST",
    url: "https://crm.aspectsclinica.net/api/crm/ingest/whatsapp",
    authentication: "genericCredentialType",
    genericAuthType: "httpHeaderAuth",
    sendBody: true,
    specifyBody: "json",
    jsonBody: "={{ $json }}",
    options: {},
  },
  credentials: {
    httpHeaderAuth: {
      id: "SwiJ0RFAil1BxZz5",
      name: "Aspects CRM Ingest",
    },
  },
  retryOnFail: true,
  maxTries: 3,
  waitBetweenTries: 1000,
};

workflow.nodes = workflow.nodes
  .filter((node) => node.id !== existingTransform.id && node.name !== ingestNode.name)
  .concat(normalizeNode, ingestNode);

workflow.connections = {
  ...workflow.connections,
  "WhatsApp Events (POST)": {
    main: [[{ node: normalizeNode.name, type: "main", index: 0 }]],
  },
  [normalizeNode.name]: {
    main: [[{ node: ingestNode.name, type: "main", index: 0 }]],
  },
};

delete workflow.connections[existingTransform.name];
delete workflow.versionId;

await writeFile(outputPath, `${JSON.stringify(workflow, null, 2)}\n`, "utf8");
