# Component Reference

Concrete implementation patterns for common UI components. The agent reads this file when it needs specific examples.

## Premium Card

```tsx
<Card>
  <CardHeader>
    <CardTitle className="text-lg font-semibold tracking-tight">
      Section Title
    </CardTitle>
    <CardDescription>Brief supporting context.</CardDescription>
  </CardHeader>
  <CardContent>
    {/* Content here */}
  </CardContent>
  <CardFooter className="flex justify-end gap-2">
    <Button variant="outline">Cancel</Button>
    <Button>Save changes</Button>
  </CardFooter>
</Card>
```

### Highlighted card (e.g. popular plan)

```tsx
<Card className="border-primary relative">
  <span className="absolute -top-3 right-4 rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground">
    Popular
  </span>
  {/* ... */}
</Card>
```

## Stat / Metric Card

```tsx
<div className="rounded-xl border bg-card p-6">
  <p className="text-sm font-medium text-muted-foreground tracking-tight">
    Total Projects
  </p>
  <div className="mt-2 flex items-baseline gap-2">
    <span className="text-2xl font-bold tabular-nums tracking-tight">
      1,284
    </span>
    <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
      +12.5%
    </span>
  </div>
</div>
```

## Sticky Header

```tsx
<header className="sticky top-0 z-50 flex h-14 items-center border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
  <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 lg:px-6">
    <Logo />
    <nav className="hidden items-center gap-6 text-sm md:flex">
      <Link href="/features" className="text-muted-foreground hover:text-foreground transition-colors">Features</Link>
      <Link href="/pricing" className="text-muted-foreground hover:text-foreground transition-colors">Pricing</Link>
    </nav>
    <div className="flex items-center gap-2">
      <ThemeToggle />
      <Button variant="outline" size="sm" render={<Link href="/login" />}>Log in</Button>
      <Button size="sm" render={<Link href="/signup" />}>Get started</Button>
    </div>
  </div>
</header>
```

## Form Field

```tsx
<div className="space-y-2">
  <Label htmlFor="email">Email address</Label>
  <Input
    id="email"
    type="email"
    placeholder="you@example.com"
    aria-invalid={!!errors.email}
    aria-describedby={errors.email ? "email-error" : undefined}
  />
  {errors.email && (
    <p id="email-error" role="alert" className="text-sm text-destructive">
      {errors.email}
    </p>
  )}
</div>
```

## Empty State

```tsx
<div className="flex flex-col items-center justify-center py-16 text-center">
  <div className="mb-4 rounded-full bg-muted p-4">
    <ImageIcon className="h-8 w-8 text-muted-foreground" />
  </div>
  <h3 className="text-lg font-semibold tracking-tight">No photos yet</h3>
  <p className="mt-1 max-w-sm text-sm text-muted-foreground">
    Upload your first photo to get an AI-powered critique.
  </p>
  <Button className="mt-6">
    <Upload className="mr-2 h-4 w-4" />
    Upload photo
  </Button>
</div>
```

## Loading Skeleton

```tsx
<div className="space-y-4">
  <Skeleton className="h-8 w-48" />          {/* Title */}
  <Skeleton className="h-4 w-full" />         {/* Line 1 */}
  <Skeleton className="h-4 w-3/4" />          {/* Line 2 */}
  <div className="grid gap-4 md:grid-cols-3">
    <Skeleton className="h-32 rounded-xl" />   {/* Card 1 */}
    <Skeleton className="h-32 rounded-xl" />   {/* Card 2 */}
    <Skeleton className="h-32 rounded-xl" />   {/* Card 3 */}
  </div>
</div>
```

## Button with Loading State

```tsx
<Button disabled={isPending}>
  {isPending ? (
    <>
      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      Saving...
    </>
  ) : (
    "Save changes"
  )}
</Button>
```

## Badge / Status Pill

```tsx
{/* Semantic status badges -- limited palette */}
<Badge variant="default">Active</Badge>                           {/* Primary bg */}
<Badge variant="secondary">Draft</Badge>                          {/* Muted bg */}
<Badge variant="outline">Pending</Badge>                          {/* Border only */}
<Badge variant="destructive">Failed</Badge>                       {/* Red */}

{/* For success/warning where no built-in variant exists */}
<span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
  Approved
</span>
```

## Responsive Grid

```tsx
{/* Cards grid -- 1 col mobile, 2 col tablet, 3 col desktop */}
<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
  {items.map(item => (
    <Card key={item.id}>{/* ... */}</Card>
  ))}
</div>

{/* Two-column layout with sidebar */}
<div className="grid gap-6 lg:grid-cols-[1fr_320px]">
  <main>{/* Primary content */}</main>
  <aside>{/* Sidebar */}</aside>
</div>
```

## Toast Usage

```tsx
import { toast } from "sonner";

toast.success("Photo uploaded successfully");
toast.error("Upload failed. Please try again.");
toast("Processing your photo...", {
  description: "This usually takes 10-15 seconds.",
});
```

## Dialog / Modal

```tsx
<Dialog>
  <DialogTrigger render={<Button variant="outline" />}>
    Delete project
  </DialogTrigger>
  <DialogContent className="max-w-md">
    <DialogHeader>
      <DialogTitle>Delete this project?</DialogTitle>
      <DialogDescription>
        This action cannot be undone. All critiques and versions will be
        permanently removed.
      </DialogDescription>
    </DialogHeader>
    <DialogFooter className="flex justify-end gap-2">
      <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
      <Button variant="destructive" onClick={handleDelete}>
        Delete project
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

## Page Section (Marketing)

```tsx
<section className="py-20">
  <div className="mx-auto max-w-6xl px-4 lg:px-6">
    <div className="mx-auto max-w-2xl text-center">
      <h2 className="text-3xl font-bold tracking-tight">
        Section headline here
      </h2>
      <p className="mt-4 text-lg text-muted-foreground">
        One to two sentences of supporting context.
      </p>
    </div>
    <div className="mt-12 grid gap-8 md:grid-cols-3">
      {/* Feature cards */}
    </div>
  </div>
</section>

{/* Alternating background for visual rhythm */}
<section className="bg-muted/30 py-20">
  {/* ... */}
</section>
```
