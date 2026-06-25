import { afterEach, describe, expect, it } from "vitest";
import { NotFoundError } from "../src/errors.js";
import { createLapClient } from "../src/lapClient.js";
import { startMockLap, type MockLapServer } from "./mocks/lap.js";

const servers: MockLapServer[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0, servers.length).map(async (server) => {
      await server.stop();
    }),
  );
});

async function bootMock(): Promise<MockLapServer> {
  const server = await startMockLap();
  servers.push(server);
  return server;
}

describe("lap client", () => {
  it("getLap returns the typed lap for a valid lap number", async () => {
    const server = await bootMock();
    const client = createLapClient({
      baseUrl: server.baseUrl,
      getAccessToken: () => server.state.token,
    });

    const lap = await client.getLap(10);

    expect(lap).toEqual(server.state.laps[10]);
  });

  it("getStory returns the typed story for a valid story number", async () => {
    const server = await bootMock();
    const client = createLapClient({
      baseUrl: server.baseUrl,
      getAccessToken: () => server.state.token,
    });

    const story = await client.getStory(42);

    expect(story).toEqual(server.state.stories[42]);
  });

  it("listStories returns story summaries for a valid lap", async () => {
    const server = await bootMock();
    const client = createLapClient({
      baseUrl: server.baseUrl,
      getAccessToken: () => server.state.token,
    });

    const stories = await client.listStories(10);

    expect(stories).toEqual(server.state.lapStories[10]);
  });

  it("getLap throws NotFoundError for an unknown lap", async () => {
    const server = await bootMock();
    const client = createLapClient({
      baseUrl: server.baseUrl,
      getAccessToken: () => server.state.token,
    });

    await expect(client.getLap(999)).rejects.toThrow(NotFoundError);
  });

  it("getStory throws NotFoundError for an unknown story", async () => {
    const server = await bootMock();
    const client = createLapClient({
      baseUrl: server.baseUrl,
      getAccessToken: () => server.state.token,
    });

    await expect(client.getStory(999)).rejects.toThrow(NotFoundError);
  });

  it("listStories throws NotFoundError for an unknown lap", async () => {
    const server = await bootMock();
    const client = createLapClient({
      baseUrl: server.baseUrl,
      getAccessToken: () => server.state.token,
    });

    await expect(client.listStories(999)).rejects.toThrow(NotFoundError);
  });
});
