"use client";

import { useAuth, Organization } from "./AuthProvider";
import { Building2, ChevronsUpDown, Check, Plus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";

function getTierBadgeVariant(tierId: string | null): "default" | "secondary" | "destructive" | "outline" {
  switch (tierId) {
    case "enterprise":
      return "default";
    case "pro":
      return "default";
    case "starter":
      return "secondary";
    default:
      return "outline";
  }
}

function getTierLabel(tierId: string | null): string {
  switch (tierId) {
    case "enterprise":
      return "Enterprise";
    case "pro":
      return "Pro";
    case "starter":
      return "Starter";
    default:
      return "Free";
  }
}

export function OrganizationSwitcher() {
  const { currentOrganization, organizations, switchOrganization } = useAuth();

  if (!currentOrganization) {
    return (
      <div className="flex items-center gap-3 px-2 py-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-md border bg-muted">
          <Building2 className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="flex flex-col">
          <span className="text-sm font-medium">Loading...</span>
        </div>
      </div>
    );
  }

  // If only one org, just show it without dropdown
  if (organizations.length <= 1) {
    return (
      <div className="flex items-center gap-3 px-2 py-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-md border bg-primary/10">
          <Building2 className="h-4 w-4 text-primary" />
        </div>
        <div className="flex flex-col min-w-0">
          <span className="text-sm font-medium truncate">{currentOrganization.name}</span>
          <Badge variant={getTierBadgeVariant(currentOrganization.subscription_tier_id)} className="text-[10px] px-1.5 py-0 w-fit">
            {getTierLabel(currentOrganization.subscription_tier_id)}
          </Badge>
        </div>
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex w-full items-center gap-3 rounded-lg px-2 py-2 hover:bg-accent transition-colors">
          <div className="flex h-8 w-8 items-center justify-center rounded-md border bg-primary/10">
            <Building2 className="h-4 w-4 text-primary" />
          </div>
          <div className="flex flex-1 flex-col min-w-0 text-left">
            <span className="text-sm font-medium truncate">{currentOrganization.name}</span>
            <Badge variant={getTierBadgeVariant(currentOrganization.subscription_tier_id)} className="text-[10px] px-1.5 py-0 w-fit">
              {getTierLabel(currentOrganization.subscription_tier_id)}
            </Badge>
          </div>
          <ChevronsUpDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-56" align="start" sideOffset={4}>
        <DropdownMenuLabel>Organizations</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {organizations.map((org) => (
          <DropdownMenuItem
            key={org.id}
            onClick={() => switchOrganization(org.id)}
            className="flex items-center gap-3 cursor-pointer"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-md border">
              <Building2 className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="flex flex-1 flex-col min-w-0">
              <span className="text-sm font-medium truncate">{org.name}</span>
              <Badge variant={getTierBadgeVariant(org.subscription_tier_id)} className="text-[10px] px-1.5 py-0 w-fit">
                {getTierLabel(org.subscription_tier_id)}
              </Badge>
            </div>
            {org.id === currentOrganization.id && (
              <Check className="h-4 w-4 text-primary flex-shrink-0" />
            )}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <a href="/settings" className="flex items-center gap-2 cursor-pointer">
            <Plus className="h-4 w-4" />
            <span>Create Organization</span>
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
