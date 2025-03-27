# Distributed Worker Demo

Distributed Worker Demo is a system demo that runs distributed tasks remotely and saves their results and logs.

> In real projects, mobile game/app and desktop web browser tests are run remotely in a distributed manner, and their results and logs are collected.
> See the [dogu](https://github.com/dogu-team/dogu) project.

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

## Why Use This Tech Stack?

TODO

### Why TypeScript?

TODO

### Why HTTP?

TODO

### Why PostgreSQL?

TODO
