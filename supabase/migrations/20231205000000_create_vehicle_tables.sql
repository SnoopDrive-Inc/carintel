-- Create vehicle_specs table
CREATE TABLE IF NOT EXISTS vehicle_specs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    year INTEGER NOT NULL,
    make VARCHAR(100) NOT NULL,
    model VARCHAR(100) NOT NULL,
    trim VARCHAR(200),
    style VARCHAR(200),
    trim_and_style VARCHAR(400),
    summary TEXT,
    base_msrp NUMERIC(10,2),
    invoice_price NUMERIC(10,2),
    delivery_charges NUMERIC(10,2),
    epa_classification VARCHAR(100),
    body_type VARCHAR(100),
    doors INTEGER,
    engine_type VARCHAR(100),
    engine_displacement VARCHAR(50),
    engine_cylinders INTEGER,
    engine_horsepower INTEGER,
    engine_torque INTEGER,
    fuel_type VARCHAR(50),
    transmission_type VARCHAR(100),
    transmission_speeds INTEGER,
    transmission_description VARCHAR(255),
    mpg_city INTEGER,
    mpg_highway INTEGER,
    mpg_combined INTEGER,
    tank_capacity NUMERIC(5,2),
    dimensions JSONB,
    specifications JSONB,
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    sample_vin VARCHAR(17),
    UNIQUE (year, make, model, trim, style)
);

-- Create indexes for vehicle_specs
CREATE INDEX IF NOT EXISTS idx_vehicle_specs_make ON vehicle_specs(make);
CREATE INDEX IF NOT EXISTS idx_vehicle_specs_sample_vin ON vehicle_specs(sample_vin);
CREATE INDEX IF NOT EXISTS idx_vehicle_specs_year ON vehicle_specs(year);
CREATE INDEX IF NOT EXISTS idx_vehicle_specs_ymmt ON vehicle_specs(year, make, model, trim);

-- Create vehicle_warranties table
CREATE TABLE IF NOT EXISTS vehicle_warranties (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_spec_id UUID NOT NULL REFERENCES vehicle_specs(id) ON DELETE CASCADE,
    warranty_type VARCHAR(50) NOT NULL,
    months INTEGER,
    miles INTEGER,
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (vehicle_spec_id, warranty_type)
);

-- Create index for vehicle_warranties
CREATE INDEX IF NOT EXISTS idx_vehicle_warranties_spec ON vehicle_warranties(vehicle_spec_id);

-- Enable Row Level Security (optional, can be configured later)
ALTER TABLE vehicle_specs ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_warranties ENABLE ROW LEVEL SECURITY;

-- Create policies for public read access (adjust as needed)
CREATE POLICY "Allow public read access on vehicle_specs"
    ON vehicle_specs FOR SELECT
    USING (true);

CREATE POLICY "Allow public read access on vehicle_warranties"
    ON vehicle_warranties FOR SELECT
    USING (true);
