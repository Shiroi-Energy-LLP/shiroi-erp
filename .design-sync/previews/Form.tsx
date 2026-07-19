import {
  Form, FormField, FormItem, FormLabel, FormControl, FormDescription, FormMessage,
  Input, Button,
} from '@repo/ui';
import { useForm } from 'react-hook-form';

export function LeadForm() {
  const form = useForm({
    defaultValues: { customer: 'Kumar Residence', load: '8', email: '' },
  });
  return (
    <Form {...form}>
      <form style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 380 }}>
        <FormField
          control={form.control}
          name="customer"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Customer name</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormDescription>As it appears on the electricity bill.</FormDescription>
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="load"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Sanctioned load (kW)</FormLabel>
              <FormControl>
                <Input type="number" {...field} />
              </FormControl>
            </FormItem>
          )}
        />
        <Button variant="default" size="sm" style={{ alignSelf: 'flex-start' }}>Save lead</Button>
      </form>
    </Form>
  );
}
