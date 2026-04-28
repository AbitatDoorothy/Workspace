#!/usr/bin/env node
import dgram from "node:dgram";
import net from "node:net";

const PORT = Number(process.env.ABITAT_EDGE_DNS_PORT ?? 55353);
const HOST = "127.0.0.1";
const records = new Map([
  ["region1.v2.argotunnel.com", ["198.41.192.7", "198.41.192.37"]],
  ["region2.v2.argotunnel.com", ["198.41.200.13", "198.41.200.113"]],
  ["us-region1.v2.argotunnel.com", ["198.41.218.1", "198.41.218.5"]],
  ["us-region2.v2.argotunnel.com", ["198.41.219.1", "198.41.219.6"]]
]);

const server = dgram.createSocket("udp4");
const tcpServer = net.createServer((socket) => {
  socket.on("data", (data) => {
    if (data.length < 3) {
      return;
    }

    const length = data.readUInt16BE(0);
    const message = data.subarray(2, 2 + length);
    const response = resolveMessage(message);
    if (!response) {
      return;
    }

    const framed = Buffer.alloc(response.length + 2);
    framed.writeUInt16BE(response.length, 0);
    response.copy(framed, 2);
    socket.write(framed);
  });
});
const keepAlive = setInterval(() => {}, 1 << 30);

server.on("message", (message, remote) => {
  const response = resolveMessage(message);
  if (!response) {
    return;
  }

  server.send(response, remote.port, remote.address);
});

server.on("error", (error) => {
  console.error(error);
  clearInterval(keepAlive);
  process.exit(1);
});

server.bind(PORT, HOST, () => {
  server.ref();
  console.log(`edge-dns=${HOST}:${PORT}`);
});

tcpServer.listen(PORT, HOST, () => {
  tcpServer.ref();
});

function resolveMessage(message) {
  const query = parseQuery(message);
  if (!query) {
    return null;
  }

  const ips = query.type === 1 ? (records.get(query.name) ?? []) : [];
  if (process.env.ABITAT_EDGE_DNS_DEBUG === "1") {
    console.log(`edge-dns-query=${query.name}:${query.type}:${ips.join(",")}`);
  }
  return buildResponse(message, query, ips);
}

function parseQuery(message) {
  if (message.length < 13) {
    return null;
  }

  let offset = 12;
  const labels = [];
  while (offset < message.length) {
    const length = message[offset];
    if (length === 0) {
      offset += 1;
      break;
    }

    labels.push(message.subarray(offset + 1, offset + 1 + length).toString("ascii"));
    offset += length + 1;
  }

  if (offset + 4 > message.length) {
    return null;
  }

  return {
    endOffset: offset + 4,
    name: labels.join(".").toLowerCase(),
    type: message.readUInt16BE(offset)
  };
}

function buildResponse(request, query, ips) {
  const question = request.subarray(12, query.endOffset);
  const answers = ips.map((ip) => {
    const answer = Buffer.alloc(16);
    answer.writeUInt16BE(0xc00c, 0);
    answer.writeUInt16BE(1, 2);
    answer.writeUInt16BE(1, 4);
    answer.writeUInt32BE(60, 6);
    answer.writeUInt16BE(4, 10);
    ip.split(".").forEach((part, index) => {
      answer[12 + index] = Number(part);
    });
    return answer;
  });

  const response = Buffer.alloc(12);
  request.copy(response, 0, 0, 2);
  response.writeUInt16BE(0x8180, 2);
  response.writeUInt16BE(1, 4);
  response.writeUInt16BE(answers.length, 6);
  response.writeUInt16BE(0, 8);
  response.writeUInt16BE(0, 10);
  return Buffer.concat([response, question, ...answers]);
}
