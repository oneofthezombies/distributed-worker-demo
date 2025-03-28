# Distributed Worker Demo

This is a simple system that runs distributed tasks remotely and collects their results and logs.

> In real-world use cases, mobile game/app tests and desktop browser tests are run remotely in parallel, and their results and logs are gathered for analysis.  
> See the [dogu](https://github.com/dogu-team/dogu) project for more context.

## Table of Contents

<!-- toc -->

- [System Design](#system-design)
  - [System Architecture Diagram](#system-architecture-diagram)
  - [Sequence Diagram](#sequence-diagram)
- [What Technologies Are Used?](#what-technologies-are-used)
  - [Why TypeScript?](#why-typescript)
  - [Why HTTP/1.1?](#why-http11)
  - [Why PostgreSQL?](#why-postgresql)
  - [Why Node.js Cluster?](#why-nodejs-cluster)

<!-- tocstop -->

## System Design

This demo consists of two components: the **Agent** and the **Agent API**.

- The **Agent** sends HTTP requests to the Agent API to fetch tasks, execute them, and upload the results and logs.
- Each Agent can process **N tasks in parallel**.
- The **Agent API** is a **multi-process server** that shares a single port to efficiently handle gzip decompression.
- Both the Agent and the Agent API are **horizontally scalable**.

### System Architecture Diagram

![System architecture diagram](/images/system_architecture.svg)

### Sequence Diagram

![Sequence diagram](/images/sequence_diagram.svg)

## What Technologies Are Used?

This demo is built with TypeScript (Node.js), the HTTP protocol, and PostgreSQL.  
Here's why I decided to use each of them.

### Why TypeScript?

TypeScript is a superset of JavaScript, and understanding JavaScript is essential when working on web projects—because browsers only understand JavaScript or WebAssembly. In this project, I wanted to build a landing site, a user console site, and a desktop app. So it made sense to include them in the tech stack. They offer strong IDE support, a reliable runtime with great debugging tools, and access to a large ecosystem of libraries.

While WebAssembly is a promising technology, it feels like it’s not quite mature enough yet—especially for an early-stage startup. Many languages support WebAssembly, but none are as stable or widely adopted for the web as JavaScript and TypeScript.

I chose TypeScript (instead of plain JavaScript) for both the frontend and backend. The reason is simple: type checking. In the early stages of a startup, interfaces change frequently. With TypeScript, I could confidently redesign shared types between frontend and backend without worrying about breaking things silently.

Using the same language for both frontend and backend also made the development environment simpler. It unified tools like the IDE, debugger, and build/deployment process, which made everything easier to manage.

For the desktop app, I used Electron—which meant I could also write it entirely in TypeScript.

Later on, I added support for game and mobile automation using other languages like C# (Unity), Kotlin (Android), Swift (iOS), and Python (scripting). But even then, the core logic remained in TypeScript and communicated with those other languages over HTTP or WebSocket, keeping their code simple and minimizing complexity.

### Why HTTP/1.1?

After considering three protocols for communication between the Agent and the Agent API—HTTP/1.1, WebSocket, and gRPC—I ultimately chose HTTP/1.1.

HTTP/1.1 is the protocol that web browsers use to communicate with servers.
Since web browsers understand JavaScript, WebAssembly, HTTP/1.1, and WebSocket, it made sense to align with that.
Just like I chose JavaScript/TypeScript for the language, choosing HTTP/1.1 and WebSocket helped me keep the tech stack simple and consistent.
This is important for early-stage startups, where focusing on product development is more valuable than managing complex infrastructure.

At first, I built a prototype using gRPC.
It has many advantages, especially because it’s based on HTTP/2 and uses Protobuf for fast binary communication.
However, I found that the debugging process was more challenging than expected, as Protobuf made it harder to troubleshoot, and CLI/GUI tools for testing and debugging gRPC weren’t very satisfying.
At the time, gRPC Server Reflection wasn’t available, so I had to load .proto files manually every time.
Also, Protobuf isn’t only for gRPC—so if I need fast binary encoding, I can still use Protobuf in HTTP/1.1 or WebSocket payloads.
That’s why I decided not to use gRPC for this project.

I also tried using WebSocket for task fetching.
The Agent opened a WebSocket connection and sent `pull_task` events (with unique event IDs) to the server.
But it felt like I was reinventing HTTP.
Since this was a request-response pattern, I realized HTTP/1.1 was a better fit.
Alternatively, I could’ve used a server-push model where the Agent receives `push_task` events through WebSocket (or Server-Sent Events).
But that meant the server would need to decide which Agent should receive each task.
This would require a scheduler to generate and manage those events.
Also, since WebSocket keeps a persistent connection open, the Agent API would have to forward those events to the right Agent.
To avoid that complexity, I chose to use HTTP/1.1 for the Agent API.

Later, I added a heartbeat system and scheduler to check if an Agent is online or if a task is running.
Still, if something can be built with request-response, I used HTTP/1.1.
Only when a publish-subscribe model is truly needed, I used WebSocket.

### Why PostgreSQL?

TODO

### Why Node.js Cluster?

TODO
