For some reason the supabase_storage_admin initializes with null password. It has to be manually set:  

    docker exec -it supabase-db psql -U supabase_admin -d postgres -c "ALTER ROLE supabase_storage_admin PASSWORD '${POSTGRES_PASSWORD}';"
