# Deep Research Agent

## Overview

The **Deep Research Agent** is a simple implementation of a deep research agent, similar to OpenAI's capabilities.

## Requirements

Before running the agent, ensure you have the following dependencies installed and configured:

-   **Bun:** A fast JavaScript bundler and runtime. Install Bun by running the following command:

    ```bash
    curl -fsSL [https://bun.sh/install](https://bun.sh/install) | bash
    ```

-   **Environment Variables:** You will need a `.env.local` file containing your API keys. This file should include the following environment variables:

    ```
    OPENAI_API_KEY=<Your OpenAI API Key>
    FIRECRAWL_API_KEY=<Your Firecrawl API Key>
    ```

## How to Run the Agent

To execute the agent, run the following command in your terminal:

```bash
bun src/app/agents.ts