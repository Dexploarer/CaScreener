import { z } from "zod";

export const BoundString = z
  .object({
    literalString: z.string().optional(),
    path: z.string().optional(),
  })
  .refine((d) => d.literalString != null || d.path != null);

export const Children = z
  .object({
    explicitList: z.array(z.string()).optional(),
    template: z
      .object({
        dataBinding: z.string(),
        componentId: z.string(),
      })
      .optional(),
  })
  .refine((d) => d.explicitList != null || d.template != null);

export const A2UIComponent = z.object({
  id: z.string(),
  component: z.record(z.string(), z.record(z.string(), z.unknown())),
});

export const SurfaceUpdate = z.object({
  surfaceId: z.string().optional(),
  components: z.array(A2UIComponent),
});

export const A2UIMessage = z.object({
  surfaceUpdate: SurfaceUpdate.optional(),
  beginRendering: z
    .object({
      surfaceId: z.string().optional(),
      root: z.string(),
      catalogId: z.string().optional(),
    })
    .optional(),
});

export type A2UIMessageType = z.infer<typeof A2UIMessage>;
