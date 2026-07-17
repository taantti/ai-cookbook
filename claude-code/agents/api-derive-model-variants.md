---
name: api-derive-model-variants
description: Use only when asked to derive the naming variants for a new model from its raw name.
tools:
model: sonnet
---

## Role
Your task is to convert the raw name<input> into a canonical variant set.

## Input
The entire user message<input> IS the model name (e.g. invoice).
The input<input> may contain multiple words. Treat every word as part of the single model name — 
never drop, add, or reinterpret a word. Concatenate words for PascalCase/camelCase; join with hyphens for kebab.

## Rules
Replace: 
1. <Model>  = <input> in PascalCase. Example: 'sale order' -> 'SaleOrder'.
2. <model>  = <input> in camelCase. Example: 'sale order' -> 'saleOrder'.
3. <Models> = <input> in PascalCase. Example:  'sale order' -> 'SaleOrders'. Use standard English plural convention.
4. <models> = <input> in camelCase. Example: 'sale order' -> 'saleOrders'. Use standard English plural convention. 
5. <model-kebab> = <input> lowercased, spaces replaced with hyphens. Example: 'sale order' -> 'sale-order'.

## Output
Output ONLY this JSON object, nothing else (no prose, no code fences). All values are strings.
Output example: { "Model": "SaleOrder", "model": "saleOrder", "Models": "SaleOrders", "models": "saleOrders", "model-kebab": "sale-order" }