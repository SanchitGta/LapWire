type AsyncOrSync<T> = Promise<T> | T;

export type MockCall<TArgs extends unknown[] = unknown[]> = {
  args: TArgs;
};

export type MockFn<TArgs extends unknown[] = unknown[], TResult = void> = ((...args: TArgs) => Promise<TResult>) & {
  calls: Array<MockCall<TArgs>>;
  lastCall: () => MockCall<TArgs> | undefined;
};

export type SlackCommand = {
  command: '/meta';
  text: string;
  user_id: string;
  channel_id: string;
  trigger_id: string;
  team_id?: string;
  response_url?: string;
};

export type SlackActionBody = {
  trigger_id: string;
  user: { id: string };
  channel?: { id: string };
  message?: { ts: string };
  actions: Array<{
    action_id: string;
    value?: string;
    block_id?: string;
  }>;
  view?: {
    private_metadata?: string;
    state?: {
      values: Record<
        string,
        Record<
          string,
          {
            type?: string;
            value?: string;
            selected_option?: { value: string };
            selected_options?: Array<{ value: string }>;
            selected_conversation?: string;
          }
        >
      >;
    };
  };
};

export type SlackViewStateValues = Record<
  string,
  Record<
    string,
    {
      type?: string;
      value?: string;
      selected_option?: { value: string };
      selected_options?: Array<{ value: string }>;
      selected_conversation?: string;
    }
  >
>;

export type SlackViewBody = {
  trigger_id: string;
  user: { id: string };
  view: {
    callback_id: string;
    private_metadata?: string;
    state: {
      values: SlackViewStateValues;
    };
  };
};

export type SlackClientMock = {
  views: {
    open: MockFn<[payload: unknown], unknown>;
    push: MockFn<[payload: unknown], unknown>;
    update: MockFn<[payload: unknown], unknown>;
  };
  chat: {
    update: MockFn<[payload: unknown], unknown>;
    postEphemeral: MockFn<[payload: unknown], unknown>;
    postMessage: MockFn<[payload: unknown], unknown>;
  };
};

export type SlackHandlerArgs<TBody = unknown> = {
  ack: MockFn<[response?: unknown], void>;
  respond: MockFn<[message: unknown], void>;
  say: MockFn<[message: unknown], void>;
  client: SlackClientMock;
  body: TBody;
  command?: SlackCommand;
  action?: TBody extends SlackActionBody ? SlackActionBody['actions'][number] : never;
  view?: TBody extends SlackViewBody ? SlackViewBody['view'] : never;
  logger: {
    info: MockFn<[...args: unknown[]], void>;
    warn: MockFn<[...args: unknown[]], void>;
    error: MockFn<[...args: unknown[]], void>;
  };
};

export function createMockFn<TArgs extends unknown[] = unknown[], TResult = void>(
  implementation?: (...args: TArgs) => AsyncOrSync<TResult>,
): MockFn<TArgs, TResult> {
  const calls: Array<MockCall<TArgs>> = [];

  const fn = (async (...args: TArgs) => {
    calls.push({ args });
    return implementation ? implementation(...args) : (undefined as TResult);
  }) as MockFn<TArgs, TResult>;

  fn.calls = calls;
  fn.lastCall = () => calls[calls.length - 1];
  return fn;
}

export function createSlackClientMock(): SlackClientMock {
  return {
    views: {
      open: createMockFn(),
      push: createMockFn(),
      update: createMockFn(),
    },
    chat: {
      update: createMockFn(),
      postEphemeral: createMockFn(),
      postMessage: createMockFn(),
    },
  };
}

export function createCommandArgs(overrides: Partial<SlackCommand> = {}): SlackHandlerArgs<SlackCommand> {
  const command: SlackCommand = {
    command: '/meta',
    text: '',
    user_id: 'U_TEST',
    channel_id: 'C_TEST',
    trigger_id: 'trigger-test',
    team_id: 'T_TEST',
    response_url: 'https://slack.test/respond',
    ...overrides,
  };

  return createBaseArgs(command, { command });
}

export function createActionArgs(
  actionId: string,
  overrides: Partial<SlackActionBody> = {},
): SlackHandlerArgs<SlackActionBody> {
  const body: SlackActionBody = {
    trigger_id: 'trigger-action',
    user: { id: 'U_TEST' },
    channel: { id: 'C_TEST' },
    message: { ts: '1719321600.000100' },
    actions: [{ action_id: actionId, value: JSON.stringify({ projectId: 'vY8joe', org: 'acme' }) }],
    ...overrides,
  };

  return createBaseArgs(body, {
    action: body.actions[0],
  });
}

export function createViewSubmitArgs(
  callbackId: string,
  stateValues: SlackViewStateValues,
  overrides: Partial<SlackViewBody> = {},
): SlackHandlerArgs<SlackViewBody> {
  const body: SlackViewBody = {
    trigger_id: 'trigger-view',
    user: { id: 'U_TEST' },
    view: {
      callback_id: callbackId,
      private_metadata: JSON.stringify({ projectId: 'vY8joe', org: 'acme' }),
      state: {
        values: stateValues,
      },
    },
    ...overrides,
  };

  return createBaseArgs(body, {
    view: body.view,
  });
}

export function viewStateValue(
  blockId: string,
  actionId: string,
  value: string,
): SlackViewStateValues {
  return {
    [blockId]: {
      [actionId]: {
        type: 'plain_text_input',
        value,
      },
    },
  };
}

export function mergeViewState(
  ...states: SlackViewStateValues[]
): SlackViewStateValues {
  return Object.assign({}, ...states);
}

export function selectStateValue(
  blockId: string,
  actionId: string,
  value: string,
): SlackViewStateValues {
  return {
    [blockId]: {
      [actionId]: {
        type: 'static_select',
        selected_option: { value },
      },
    },
  };
}

export function checkboxStateValue(
  blockId: string,
  actionId: string,
  values: string[],
): SlackViewStateValues {
  return {
    [blockId]: {
      [actionId]: {
        type: 'checkboxes',
        selected_options: values.map((value) => ({ value })),
      },
    },
  };
}

function createBaseArgs<TBody>(
  body: TBody,
  extras: Partial<SlackHandlerArgs<TBody>> = {},
): SlackHandlerArgs<TBody> {
  const client = createSlackClientMock();

  return {
    ack: createMockFn(),
    respond: createMockFn(),
    say: createMockFn(),
    client,
    body,
    logger: {
      info: createMockFn(),
      warn: createMockFn(),
      error: createMockFn(),
    },
    ...extras,
  };
}
