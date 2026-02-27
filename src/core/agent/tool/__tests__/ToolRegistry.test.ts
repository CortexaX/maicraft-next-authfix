/**
 * ToolRegistry 单元测试
 */

import { ToolRegistry, ToolSchema } from '../ToolRegistry';
import { ActionExecutor } from '@/core/actions/ActionExecutor';
import { ContextManager } from '@/core/context/ContextManager';
import { RuntimeContext } from '@/core/context/RuntimeContext';
import { BaseAction } from '@/core/actions/Action';
import { ActionResult } from '@/core/actions/types';

// Mock Action for testing
class MockAction extends BaseAction<{ value: string }> {
  readonly id = 'test_action';
  readonly name = 'TestAction';
  readonly description = 'A test action for unit testing';

  async execute(_context: RuntimeContext, _params: { value: string }): Promise<ActionResult> {
    return {
      success: true,
      message: 'Test action executed',
    };
  }

  getParamsSchema() {
    return {
      type: 'object',
      properties: {
        value: {
          type: 'string',
          description: 'A test parameter',
        },
      },
      required: ['value'],
    };
  }
}

// Mock Action with flat schema format
class MockActionFlatSchema extends BaseAction<{ count: number }> {
  readonly id = 'test_action_flat';
  readonly name = 'TestActionFlat';
  readonly description = 'A test action with flat schema format';

  async execute(_context: RuntimeContext, _params: { count: number }): Promise<ActionResult> {
    return {
      success: true,
      message: 'Test action executed',
    };
  }

  getParamsSchema() {
    return {
      count: {
        type: 'number',
        description: 'A count parameter',
        required: true,
      },
    };
  }
}

// Mock Action with conditional activation
class MockActionConditional extends BaseAction<{}> {
  readonly id = 'test_action_conditional';
  readonly name = 'TestActionConditional';
  readonly description = 'A test action with conditional activation';
  private shouldActivateValue = true;

  async execute(_context: RuntimeContext, _params: {}): Promise<ActionResult> {
    return {
      success: true,
      message: 'Test action executed',
    };
  }

  shouldActivate(_context: RuntimeContext): boolean {
    return this.shouldActivateValue;
  }

  setShouldActivate(value: boolean) {
    this.shouldActivateValue = value;
  }
}

describe('ToolRegistry', () => {
  let executor: ActionExecutor;
  let contextManager: ContextManager;
  let context: RuntimeContext;
  let toolRegistry: ToolRegistry;

  // Mock dependencies
  const mockBot = {
    on: jest.fn(),
    removeListener: jest.fn(),
    entity: { position: { x: 0, y: 0, z: 0 } },
  } as any;

  const mockLogger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  beforeEach(() => {
    // Create context manager and context
    contextManager = new ContextManager();
    const mockConfig = {};
    const mockPlaceBlockUtils = {} as any;
    const mockMovementUtils = {} as any;

    context = contextManager.createContext({
      bot: mockBot,
      executor: undefined,
      config: mockConfig,
      logger: mockLogger as any,
      placeBlockUtils: mockPlaceBlockUtils,
      movementUtils: mockMovementUtils,
    });

    // Create executor
    executor = new ActionExecutor(contextManager, mockLogger as any);

    // Create tool registry
    toolRegistry = new ToolRegistry(executor, context);

    // Register mock actions
    executor.register(new MockAction());
    executor.register(new MockActionFlatSchema());
    executor.register(new MockActionConditional());
  });

  describe('getToolSchemas', () => {
    it('should generate tool schemas for all registered actions', () => {
      const schemas = toolRegistry.getToolSchemas();

      expect(schemas).toHaveLength(3);
      expect(schemas[0]).toMatchObject({
        type: 'function',
        function: {
          name: 'test_action',
          description: 'A test action for unit testing',
          parameters: {
            type: 'object',
            properties: {
              value: {
                type: 'string',
                description: 'A test parameter',
              },
            },
            required: ['value'],
          },
        },
      });
    });

    it('should convert flat schema format to standard format', () => {
      const schemas = toolRegistry.getToolSchemas();
      const flatSchema = schemas.find(s => s.function.name === 'test_action_flat');

      expect(flatSchema).toBeDefined();
      expect(flatSchema?.function.parameters).toMatchObject({
        type: 'object',
        properties: {
          count: {
            type: 'number',
            description: 'A count parameter',
          },
        },
        required: ['count'],
      });
    });
  });

  describe('getAvailableToolSchemas', () => {
    it('should filter actions based on shouldActivate', () => {
      const schemas = toolRegistry.getAvailableToolSchemas();
      expect(schemas).toHaveLength(3); // All active by default

      // Now deactivate one action
      const actions = executor.getRegisteredActions();
      const conditionalAction = actions.find(a => a.id === 'test_action_conditional') as MockActionConditional;
      conditionalAction?.setShouldActivate(false);

      const filteredSchemas = toolRegistry.getAvailableToolSchemas();
      expect(filteredSchemas).toHaveLength(2);
      expect(filteredSchemas.find(s => s.function.name === 'test_action_conditional')).toBeUndefined();
    });
  });

  describe('executeTool', () => {
    it('should execute action and return result', async () => {
      const result = await toolRegistry.executeTool('test_action', { value: 'test' });

      expect(result).toMatchObject({
        success: true,
        message: 'Test action executed',
      });
    });

    it('should handle execution errors', async () => {
      const result = await toolRegistry.executeTool('nonexistent_action', {});

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('getToolList', () => {
    it('should return list of tool names', () => {
      const toolList = toolRegistry.getToolList();

      expect(toolList).toHaveLength(3);
      expect(toolList).toContain('test_action (TestAction)');
      expect(toolList).toContain('test_action_flat (TestActionFlat)');
      expect(toolList).toContain('test_action_conditional (TestActionConditional)');
    });
  });
});
