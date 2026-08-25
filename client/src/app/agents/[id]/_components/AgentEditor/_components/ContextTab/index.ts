/* Thin re-export — the Context tab has exactly one implementation, shared
   with the skill detail pane's own `_components/ContextTab`. It lives in
   `@/components/context-tab` because route code cannot import route code
   across a different route boundary (see that file's doc comment). */
export { ContextTab, ContextTab as default } from "@/components/context-tab";
