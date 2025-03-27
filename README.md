# Distributed Worker Demo

This is a simple system that runs distributed tasks remotely and collects their results and logs.

> In real-world use cases, mobile game/app tests and desktop browser tests are run remotely in parallel, and their results and logs are gathered for analysis.  
> See the [dogu](https://github.com/dogu-team/dogu) project for more context.

## Table of Contents

- [System Design](#system-design)
  - [System Architecture Diagram](#system-architecture-diagram)
  - [Sequence Diagram](#sequence-diagram)
- [What Technologies Were Used?](#what-technologies-were-used)
  - [Why TypeScript?](#why-typescript)
  - [Why HTTP?](#why-http)
  - [Why PostgreSQL?](#why-postgresql)

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

TypeScript is a superset of JavaScript, and understanding JavaScript is essential when working on web projects—because browsers only understand JavaScript or WebAssembly.

In this project, I wanted to build a landing site, a user console site, and a desktop app. So it made sense to include JavaScript/TypeScript in the tech stack. TypeScript offers strong IDE support, a reliable runtime with great debugging tools, and access to a large ecosystem of libraries.

While WebAssembly is a promising technology, I felt it wasn’t mature enough (in the context of an early-stage startup) to fully rely on. Many languages support WebAssembly, but none are as stable or widely adopted for the web as JavaScript and TypeScript.

I chose TypeScript (instead of plain JavaScript) for both the frontend and backend. The reason is simple: **type checking**. In the early stages of a startup, interfaces change frequently. With TypeScript, I could confidently redesign shared types between frontend and backend without worrying about breaking things silently.

Using the same language for both frontend and backend also made the development environment simpler. It unified tools like the IDE, debugger, and build/deployment process, which made everything easier to manage.

For the desktop app, I used Electron—which meant I could also write it entirely in TypeScript.

Later on, I added support for game and mobile automation using other languages like C# (Unity), Kotlin (Android), Swift (iOS), and Python (scripting). But even then, the core logic remained in TypeScript and communicated with those other languages over HTTP or WebSocket, keeping their code simple and minimizing complexity.

### Why HTTP?

TODO

### Why PostgreSQL?

TODO
