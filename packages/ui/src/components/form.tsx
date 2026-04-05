'use client';

import * as React from 'react';
import {
  useFormContext,
  Controller,
  FormProvider,
  type ControllerProps,
  type FieldPath,
  type FieldValues,
} from 'react-hook-form';
import { cn } from '../lib/utils';
import { Label } from './label';

const Form = FormProvider;

type FormFieldContextValue<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
> = {
  name: TName;
};

const FormFieldContext = React.createContext<FormFieldContextValue>({} as FormFieldContextValue);

function FormField<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({ ...props }: ControllerProps<TFieldValues, TName>) {
  return (
    <FormFieldContext.Provider value={{ name: props.name }}>
      <Controller {...props} />
    </FormFieldContext.Provider>
  );
}

function useFormField() {
  const fieldContext = React.useContext(FormFieldContext);
  const { getFieldState, formState } = useFormContext();
  const fieldState = getFieldState(fieldContext.name, formState);

  return {
    name: fieldContext.name,
    ...fieldState,
  };
}

const FormItemContext = React.createContext<{ id: string }>({} as { id: string });

function FormItem({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const id = React.useId();
  return (
    <FormItemContext.Provider value={{ id }}>
      <div className={cn('space-y-1.5', className)} {...props} />
    </FormItemContext.Provider>
  );
}

function FormLabel({ className, ...props }: React.ComponentPropsWithoutRef<typeof Label>) {
  const { name, error } = useFormField();
  const { id } = React.useContext(FormItemContext);

  return (
    <Label
      className={cn(
        'text-xs font-semibold text-n-700',
        error && 'text-[#DC2626]',
        className
      )}
      htmlFor={`${id}-${name}`}
      {...props}
    />
  );
}

function FormControl({ ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const { name, error } = useFormField();
  const { id } = React.useContext(FormItemContext);

  return (
    <div
      id={`${id}-${name}`}
      aria-describedby={error ? `${id}-${name}-error` : undefined}
      aria-invalid={!!error}
      {...props}
    />
  );
}

function FormMessage({ className, children, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  const { name, error } = useFormField();
  const { id } = React.useContext(FormItemContext);
  const body = error ? String(error?.message) : children;

  if (!body) return null;

  return (
    <p
      id={`${id}-${name}-error`}
      role="alert"
      className={cn('text-[11px] text-[#DC2626]', className)}
      {...props}
    >
      {body}
    </p>
  );
}

function FormDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-[11px] text-n-500', className)} {...props} />;
}

export {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
  FormDescription,
  useFormField,
};
