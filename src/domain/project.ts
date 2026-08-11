import { z } from "zod";

export const projectStatusSchema = z.enum(["active", "archived"]);

export const projectSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1),
  premise: z.string(),
  genre: z.string(),
  status: projectStatusSchema,
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export const createProjectInputSchema = z.object({
  title: z.string().trim().min(1, "Project title is required").max(120, "Project title must be 120 characters or fewer"),
  premise: z.string().trim().max(2000, "Premise must be 2,000 characters or fewer").default(""),
  genre: z.string().trim().max(80, "Genre must be 80 characters or fewer").default(""),
}).strict();

export const updateProjectInputSchema = z
  .object({
    title: z.string().trim().min(1, "Project title is required").max(120, "Project title must be 120 characters or fewer").optional(),
    premise: z.string().trim().max(2000, "Premise must be 2,000 characters or fewer").optional(),
    genre: z.string().trim().max(80, "Genre must be 80 characters or fewer").optional(),
    status: projectStatusSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one project field is required",
  })
  .strict();

export type Project = z.infer<typeof projectSchema>;
export type CreateProjectInput = z.input<typeof createProjectInputSchema>;
export type UpdateProjectInput = z.input<typeof updateProjectInputSchema>;

export type ProjectStatus = Project["status"];
