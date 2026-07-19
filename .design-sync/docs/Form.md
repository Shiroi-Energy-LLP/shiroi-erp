---
category: Forms
keywords: form, react-hook-form, validation, field
---
react-hook-form wrapper. Spread a `useForm()` instance onto `<Form {...form}>`, then compose each field as `FormField` (with `control` + `name` + a `render` returning `FormItem` › `FormLabel` › `FormControl` › `FormDescription`/`FormMessage`). `FormMessage` renders validation errors in red automatically.
