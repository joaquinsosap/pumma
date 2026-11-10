import { cache } from "react";
import * as memory from "./memory/projects";
import * as mongo from "./mongo/projects";

const impl = process.env.DATA_SOURCE === "mongodb" ? mongo : memory;

export const listProjects = cache(impl.listProjects);
export const getProject = cache(impl.getProject);
export const insertProject = impl.insertProject;
export const updateProject = impl.updateProject;
export const deleteProject = impl.deleteProject;
export const reorderProjects = impl.reorderProjects;
export const touchProjects = impl.touchProjects;
