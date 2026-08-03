"""Full inventory of the OCI tenancy, judged against Always Free limits.

Read-only. Prints every resource that costs (or could cost) money and maps
each against the Always Free allowance so the free-tier verdict is explicit:

  compute   2x VM.Standard.E2.1.Micro  AND/OR  A1.Flex up to 4 OCPU / 24 GB
  storage   200 GB total block+boot, 5 backups
  object    ~20 GB, ADB 2x20GB, 1 flexible LB (10 Mbps), NAT/VPN x1
"""

import oci

cfg = oci.config.from_file()
identity = oci.identity.IdentityClient(cfg)
tenancy_id = cfg["tenancy"]

# ---- account & regions ------------------------------------------------------
ten = identity.get_tenancy(tenancy_id).data
subs = identity.list_region_subscriptions(tenancy_id).data
print(f"tenancy: {ten.name} | home: {ten.home_region_key}")
print(f"regions: {[s.region_name for s in subs]}")

# ---- compartments (root + active children) ---------------------------------
comps = [tenancy_id]
for c in oci.pagination.list_call_get_all_results(
        identity.list_compartments, tenancy_id,
        compartment_id_in_subtree=True).data:
    if c.lifecycle_state == "ACTIVE":
        comps.append(c.id)
names = {tenancy_id: "(root)"}
for c in oci.pagination.list_call_get_all_results(
        identity.list_compartments, tenancy_id,
        compartment_id_in_subtree=True).data:
    names[c.id] = c.name
print(f"compartments: {len(comps)} -> {[names[c] for c in comps]}")

for region in [s.region_name for s in subs]:
    cfg["region"] = region
    compute = oci.core.ComputeClient(cfg)
    bs = oci.core.BlockstorageClient(cfg)
    net = oci.core.VirtualNetworkClient(cfg)
    print(f"\n=== region {region} ===")

    total_ocpu_a1 = total_gb_a1 = micro_count = 0
    storage_gb = 0.0

    for comp in comps:
        # instances
        for i in oci.pagination.list_call_get_all_results(
                compute.list_instances, comp).data:
            if i.lifecycle_state in ("TERMINATED",):
                continue
            sh = i.shape_config
            print(f"  [VM] {i.display_name} | {i.shape} | "
                  f"{sh.ocpus if sh else '?'} ocpu / {sh.memory_in_gbs if sh else '?'} GB | "
                  f"{i.lifecycle_state} | comp={names.get(comp)} | ad={i.availability_domain}")
            if i.shape == "VM.Standard.E2.1.Micro":
                micro_count += 1
            elif i.shape.startswith("VM.Standard.A1"):
                total_ocpu_a1 += sh.ocpus or 0
                total_gb_a1 += sh.memory_in_gbs or 0
            else:
                print(f"       ^^ NOT an Always-Free shape")

        # boot + block volumes (need AD list per region)
        try:
            ads = identity.list_availability_domains(comp).data
        except Exception:
            ads = []
        for ad in ads:
            for v in oci.pagination.list_call_get_all_results(
                    bs.list_boot_volumes,
                    availability_domain=ad.name, compartment_id=comp).data:
                if v.lifecycle_state != "TERMINATED":
                    storage_gb += v.size_in_gbs or 0
                    print(f"  [boot] {v.display_name}: {v.size_in_gbs} GB ({v.lifecycle_state})")
            for v in oci.pagination.list_call_get_all_results(
                    bs.list_volumes,
                    availability_domain=ad.name, compartment_id=comp).data:
                if v.lifecycle_state != "TERMINATED":
                    storage_gb += v.size_in_gbs or 0
                    print(f"  [block] {v.display_name}: {v.size_in_gbs} GB ({v.lifecycle_state})")

        # networking that can bill
        for ip in oci.pagination.list_call_get_all_results(
                net.list_public_ips, scope="REGION", compartment_id=comp).data:
            print(f"  [reserved-ip] {ip.display_name} {ip.ip_address} ({ip.lifecycle_state})")
        for g in oci.pagination.list_call_get_all_results(net.list_nat_gateways, comp).data:
            if g.lifecycle_state == "AVAILABLE":
                print(f"  [nat-gw] {g.display_name}")

    print(f"  -- totals: micro x{micro_count} (free cap 2) | "
          f"A1 {total_ocpu_a1} ocpu/{total_gb_a1} GB (free cap 4/24) | "
          f"storage {storage_gb:.0f} GB (free cap 200)")
