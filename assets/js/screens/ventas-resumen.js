const STATUS_META = {
	pagado: { label: 'Pagado', color: 'oklch(0.72 0.16 152)' },
	pre_venta: { label: 'Pre-venta', color: 'oklch(0.72 0.13 230)' },
	credito: { label: 'Crédito', color: 'oklch(0.75 0.16 95)' },
};
const MONTH_OPTIONS_COUNT = 24; // cuántos meses hacia atrás ofrece el selector

export function renderVentasResumen( main, ctx ) {
	const { supabase, org } = ctx;
	const nowKey = monthKey( new Date() );
	let fromMonth = nowKey;
	let toMonth = nowKey;
	let sales = [];
	let memberNames = new Map();
	let cargaLabelByLotId = new Map();
	// null = cerrado; 'all' = "Artículos vendidos"; 'pagado'/'pre_venta'/'credito' = esa tarjeta
	let statusDetailFilter = null;
	let expandedVendorId = null; // vendedor con el detalle de lo que vendió desplegado
	let errorMsg = '';
	let loading = true;

	load();

	async function load() {
		loading = true;
		errorMsg = '';
		draw();

		const { start, end } = rangeBounds( fromMonth, toMonth );

		const [ salesRes, membersRes, lotsRes ] = await Promise.all( [
			supabase
				.from( 'sales' )
				.select(
					'id, customer_name, total_amount, created_at, vendor_id, status, sale_items ( id, quantity, unit_price, unit_cost, stock_lot_id, product_variants ( size, color, products ( name ) ) ), sale_payments ( amount )'
				)
				.eq( 'organization_id', org.id )
				.neq( 'status', 'anulado' )
				.gte( 'created_at', start.toISOString() )
				.lt( 'created_at', end.toISOString() )
				.order( 'created_at', { ascending: false } ),
			supabase.from( 'memberships' ).select( 'user_id, full_name' ).eq( 'organization_id', org.id ),
			// Todos los lotes de la empresa (no solo los del período) — la
			// numeración de "Carga N" es cronológica global, igual que en
			// Analítica/Productos, así que hace falta verla completa para que
			// el número de carga que se muestra acá sea el mismo en todos lados.
			supabase
				.from( 'stock_lots' )
				.select( 'id, purchase_id, created_at, stock_purchases ( created_at )' )
				.eq( 'organization_id', org.id ),
		] );

		if ( salesRes.error ) {
			errorMsg = 'No se pudo cargar el resumen: ' + salesRes.error.message;
			loading = false;
			draw();
			return;
		}

		sales = salesRes.data || [];
		memberNames = new Map( ( membersRes.data || [] ).map( ( m ) => [ m.user_id, m.full_name ] ) );
		cargaLabelByLotId = buildCargaLabels( lotsRes.data || [] );
		loading = false;
		draw();
	}

	// Misma agrupación por purchase_id (cronológica) que usa Analítica para
	// numerar "Carga N" — así una unidad vendida acá muestra el mismo número
	// de carga que ves en esa pantalla, no uno distinto calculado aparte.
	function buildCargaLabels( lotRows ) {
		const groups = new Map();
		lotRows.forEach( ( l ) => {
			const key = l.purchase_id || `lote-${ l.id }`;
			if ( ! groups.has( key ) ) {
				groups.set( key, { createdAt: l.stock_purchases?.created_at || l.created_at, lotIds: [] } );
			}
			groups.get( key ).lotIds.push( l.id );
		} );

		const ordered = Array.from( groups.values() ).sort( ( a, b ) => new Date( a.createdAt ) - new Date( b.createdAt ) );
		const map = new Map();
		ordered.forEach( ( g, i ) => {
			g.lotIds.forEach( ( id ) => map.set( id, `Carga ${ i + 1 }` ) );
		} );
		return map;
	}

	// Todo lo que se muestra en pantalla sale de una sola pasada por las
	// ventas del período (ya filtradas por rango y sin anuladas) — nada de
	// esto vuelve a pedir datos, solo agrupa lo que ya se cargó.
	function computeStats() {
		let units = 0;
		// value: Pagado = plata realmente cobrada (ventas Pagado + abonos de
		// ventas que siguen pendientes); Pre-venta/Crédito = SALDO que falta
		// cobrar (total − abonado), no el monto bruto de la venta. gross/paid
		// se guardan aparte para poder explicar el número en pantalla.
		const byStatus = {
			pagado: { count: 0, value: 0, gross: 0 },
			pre_venta: { count: 0, value: 0, gross: 0, paid: 0 },
			credito: { count: 0, value: 0, gross: 0, paid: 0 },
		};
		const items = [];
		const byCustomer = new Map();
		const byVendor = new Map();
		const bySizeColor = new Map();

		sales.forEach( ( s ) => {
			const gross = Number( s.total_amount );
			const paid = ( s.sale_payments || [] ).reduce( ( sum, p ) => sum + Number( p.amount ), 0 );
			const outstanding = 'pagado' === s.status ? 0 : Math.max( 0, gross - paid );

			if ( 'pagado' === s.status ) {
				byStatus.pagado.count += 1;
				byStatus.pagado.gross += gross;
				byStatus.pagado.value += gross;
			} else if ( byStatus[ s.status ] ) {
				byStatus[ s.status ].count += 1;
				byStatus[ s.status ].gross += gross;
				byStatus[ s.status ].paid += paid;
				byStatus[ s.status ].value += outstanding;
				if ( paid > 0 ) byStatus.pagado.value += paid; // abono ya cobrado, aunque la venta siga pendiente
			}

			const vendorKey = s.vendor_id;
			const vendorEntry = byVendor.get( vendorKey ) || {
				id: vendorKey,
				name: memberNames.get( vendorKey ) || 'Sin nombre',
				salesCount: 0,
				units: 0,
				revenue: 0,
				profit: 0,
				pending: 0, // Saldo real que falta cobrar de este vendedor (ya descuenta abonos)
				items: [],
			};
			vendorEntry.salesCount += 1;
			vendorEntry.pending += outstanding;

			const customerKey = s.customer_name && s.customer_name.trim() ? s.customer_name.trim() : 'Sin nombre';
			const customerEntry = byCustomer.get( customerKey ) || { name: customerKey, items: [], total: 0 };

			s.sale_items.forEach( ( it ) => {
				units += it.quantity;
				vendorEntry.units += it.quantity;
				if ( 'pagado' === s.status ) {
					vendorEntry.revenue += it.unit_price * it.quantity;
					vendorEntry.profit += ( it.unit_price - it.unit_cost ) * it.quantity;
				}

				const name = it.product_variants?.products?.name || 'Producto';
				const size = it.product_variants?.size;
				const color = it.product_variants?.color;
				const detail = [ size, color ].filter( Boolean ).join( ' · ' );

				const itemRow = {
					id: it.id,
					name,
					detail,
					qty: it.quantity,
					price: it.unit_price,
					cost: it.unit_cost,
					profit: it.unit_price - it.unit_cost,
					carga: cargaLabelByLotId.get( it.stock_lot_id ) || '—',
					customerName: customerKey,
					vendorId: vendorKey,
					status: s.status,
				};
				items.push( itemRow );
				vendorEntry.items.push( itemRow );

				customerEntry.items.push( { name, detail, qty: it.quantity } );
				customerEntry.total += it.unit_price * it.quantity;

				const scKey = `${ name }|${ size || '' }|${ color || '' }`;
				const scEntry = bySizeColor.get( scKey ) || { name, size, color, qty: 0 };
				scEntry.qty += it.quantity;
				bySizeColor.set( scKey, scEntry );
			} );

			byVendor.set( vendorKey, vendorEntry );
			byCustomer.set( customerKey, customerEntry );
		} );

		return {
			units,
			byStatus,
			items,
			vendorRows: Array.from( byVendor.values() ).sort( ( a, b ) => b.revenue - a.revenue ),
			customerRows: Array.from( byCustomer.values() ).sort(
				( a, b ) => b.items.reduce( ( n, i ) => n + i.qty, 0 ) - a.items.reduce( ( n, i ) => n + i.qty, 0 )
			),
			topSizeColor: Array.from( bySizeColor.values() )
				.sort( ( a, b ) => b.qty - a.qty )
				.slice( 0, 5 ),
		};
	}

	function draw() {
		const stats = computeStats();

		main.innerHTML = `
			<div style="margin-bottom:24px">
				<div style="font-size:24px;font-weight:800;letter-spacing:-0.01em">Resumen del mes</div>
				<div style="font-size:14px;color:var(--text-muted);margin-top:4px">Mini-dashboard de un mes puntual (o un rango) — no reemplaza el Dashboard operativo, es para revisar un período específico con más detalle.</div>
			</div>
			${ errorMsg ? `<div class="acp-error">${ esc( errorMsg ) }</div>` : '' }

			${ rangePickerHtml() }

			${
				loading
					? '<div class="acp-empty-state">Cargando…</div>'
					: 0 === sales.length
						? '<div class="acp-empty-state">No hay ventas en este período.</div>'
						: `
					${ kpiRowHtml( stats ) }
					${ statusDetailFilter ? statusDetailSectionHtml( stats ) : '' }
					${ pieSectionHtml( stats.byStatus ) }
					${ extraMetricsHtml( stats ) }
					${ customersHtml( stats.customerRows ) }
				`
			}
		`;

		wireEvents();
	}

	function rangePickerHtml() {
		return `
			<div style="background:var(--card);border:1px solid var(--border);border-radius:14px;padding:16px 20px;margin-bottom:20px;display:flex;align-items:flex-end;gap:14px;flex-wrap:wrap">
				<div class="acp-field" style="margin-bottom:0">
					<label>Desde</label>
					<select id="vr-from" style="background:var(--input-bg);border:1px solid var(--border);border-radius:10px;padding:10px 12px;color:var(--text);font-size:14px;font-family:inherit">${ monthOptionsHtml( fromMonth ) }</select>
				</div>
				<div class="acp-field" style="margin-bottom:0">
					<label>Hasta</label>
					<select id="vr-to" style="background:var(--input-bg);border:1px solid var(--border);border-radius:10px;padding:10px 12px;color:var(--text);font-size:14px;font-family:inherit">${ monthOptionsHtml( toMonth ) }</select>
				</div>
				<div style="font-size:11px;color:var(--text-faint2, var(--text-muted));padding-bottom:11px">Un mismo mes en ambos = ese mes solo. Distintos = todo el rango entre ellos.</div>
			</div>
		`;
	}

	function monthOptionsHtml( selectedKey ) {
		const options = [];
		const d = new Date();
		d.setDate( 1 );
		for ( let i = 0; i < MONTH_OPTIONS_COUNT; i++ ) {
			const key = monthKey( d );
			options.push( `<option value="${ key }" ${ key === selectedKey ? 'selected' : '' }>${ esc( monthLabel( d ) ) }</option>` );
			d.setMonth( d.getMonth() - 1 );
		}
		return options.join( '' );
	}

	function kpiRowHtml( stats ) {
		return `
			<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-bottom:20px">
				<div class="acp-kpi-card" style="background:var(--card);border:1px solid var(--border);border-radius:14px;padding:18px;cursor:pointer" data-status-card="all">
					<div style="font-size:12px;color:var(--text-muted);font-weight:600;margin-bottom:8px">Artículos vendidos</div>
					<div style="font-size:22px;font-weight:800">${ stats.units }</div>
					<div style="font-size:11px;color:var(--text-faint2, var(--text-muted));margin-top:4px">${ 'all' === statusDetailFilter ? 'Click para ocultar el detalle' : 'Click para ver el detalle' }</div>
				</div>
				${ [ 'pagado', 'pre_venta', 'credito' ]
					.map( ( key ) => {
						const b = stats.byStatus[ key ];
						const sub =
							'pagado' === key
								? `${ b.count } ${ 1 === b.count ? 'venta' : 'ventas' }${ b.value > b.gross ? ` · incluye ${ money( b.value - b.gross ) } abonado` : '' }`
								: `${ b.count } ${ 1 === b.count ? 'venta' : 'ventas' }${ b.paid > 0 ? ` · ${ money( b.paid ) } ya abonado` : '' }`;
						return `
					<div class="acp-kpi-card" style="background:var(--card);border:1px solid var(--border);border-radius:14px;padding:18px;cursor:pointer" data-status-card="${ key }">
						<div style="font-size:12px;color:var(--text-muted);font-weight:600;margin-bottom:8px">${ STATUS_META[ key ].label }${ 'pagado' !== key ? ' (falta cobrar)' : '' }</div>
						<div style="font-size:22px;font-weight:800;color:${ STATUS_META[ key ].color }">${ money( b.value ) }</div>
						<div style="font-size:11px;color:var(--text-faint2, var(--text-muted));margin-top:4px">${ sub } · ${ key === statusDetailFilter ? 'ocultar' : 'ver' } detalle</div>
					</div>
				`;
					} )
					.join( '' ) }
			</div>
			<div style="background:var(--input-bg);border:1px solid var(--border);border-radius:12px;padding:14px 18px;margin-bottom:20px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
				<div style="font-size:13px;color:var(--text-muted)">Ingresos posibles del período — Pagado + Pre-venta + Crédito, si todo termina cobrándose</div>
				<div style="font-size:18px;font-weight:800">${ money( stats.byStatus.pagado.value + stats.byStatus.pre_venta.value + stats.byStatus.credito.value ) }</div>
			</div>
		`;
	}

	function statusDetailSectionHtml( stats ) {
		const key = statusDetailFilter;
		const filtered = 'all' === key ? stats.items : stats.items.filter( ( it ) => it.status === key );
		const title = 'all' === key ? 'Detalle por artículo — todos' : `Detalle por artículo — ${ STATUS_META[ key ].label }`;
		const bucket = 'all' === key ? null : stats.byStatus[ key ];
		const note =
			bucket && bucket.paid > 0
				? `Abonado ${ money( bucket.paid ) } de ${ money( bucket.gross ) } — quedan ${ money( bucket.value ) } por cobrar`
				: '';
		return articleDetailHtml( filtered, title, note );
	}

	function articleDetailHtml( items, title, note ) {
		return `
			<div style="background:var(--card);border:1px solid var(--border);border-radius:14px;padding:22px;margin-bottom:20px">
				<div style="font-size:15px;font-weight:700;margin-bottom:4px">${ esc( title || 'Detalle por artículo' ) }</div>
				<div style="font-size:12px;color:var(--text-faint2, var(--text-muted));margin-bottom:${ note ? '4px' : '14px' }">Costo y ganancia son por unidad — la ganancia ya descuenta el costo (precio − costo)</div>
				${ note ? `<div style="font-size:12px;color:var(--text);font-weight:600;margin-bottom:14px">${ esc( note ) }</div>` : '' }
				<div style="display:flex;flex-direction:column;gap:8px">
					${
						0 === items.length
							? '<div style="font-size:13px;color:var(--text-muted)">Sin artículos en este filtro.</div>'
							: ''
					}
					${ items
						.map(
							( it ) => `
						<div style="border:1px solid var(--border);border-radius:10px;padding:12px">
							<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:6px;flex-wrap:wrap">
								<div style="font-size:13px;font-weight:600">${ esc( it.name ) }${ it.detail ? ' · ' + esc( it.detail ) : '' }</div>
								<div style="font-size:11px;color:var(--text-faint2, var(--text-muted))">${ esc( it.carga ) } · ${ esc( it.customerName ) }</div>
							</div>
							<div style="display:flex;flex-wrap:wrap;gap:14px;font-size:12px;color:var(--text-muted)">
								<span>Cantidad <strong style="color:var(--text)">${ it.qty }</strong></span>
								<span>Costo <strong style="color:var(--text)">${ money( it.cost ) }</strong></span>
								<span>Vendido <strong style="color:var(--text)">${ money( it.price ) }</strong></span>
								<span>Ganancia <strong style="color:${ it.profit >= 0 ? 'oklch(0.72 0.16 152)' : 'oklch(0.65 0.18 25)' }">${ money( it.profit ) }</strong></span>
							</div>
						</div>
					`
						)
						.join( '' ) }
				</div>
			</div>
		`;
	}

	function pieSectionHtml( byStatus ) {
		return `
			<div style="background:var(--card);border:1px solid var(--border);border-radius:14px;padding:22px;margin-bottom:20px">
				<div style="font-size:15px;font-weight:700;margin-bottom:4px">Pagado / Pre-venta / Crédito</div>
				<div style="font-size:12px;color:var(--text-faint2, var(--text-muted));margin-bottom:16px">Tamaño del segmento = cantidad de ventas — pasa el mouse para ver cantidad y monto de cada uno</div>
				${ pieChartHtml( byStatus ) }
			</div>
		`;
	}

	function pieChartHtml( byStatus ) {
		const segments = [ 'pagado', 'pre_venta', 'credito' ].map( ( key ) => ( {
			key,
			label: STATUS_META[ key ].label,
			color: STATUS_META[ key ].color,
			count: byStatus[ key ].count,
			value: byStatus[ key ].value,
			gross: byStatus[ key ].gross,
			paid: byStatus[ key ].paid || 0,
		} ) );

		const tooltipFor = ( seg ) => {
			const base = `${ seg.label }: ${ seg.count } ${ 1 === seg.count ? 'venta' : 'ventas' } · ${ money( seg.value ) }`;
			return seg.paid > 0 ? `${ base } (de ${ money( seg.gross ) }, abonado ${ money( seg.paid ) })` : base;
		};

		const totalCount = segments.reduce( ( sum, s ) => sum + s.count, 0 );
		const withCount = segments.filter( ( s ) => s.count > 0 );

		const cx = 90;
		const cy = 90;
		const r = 80;
		let svgBody = '';

		if ( 0 === totalCount ) {
			svgBody = `<circle cx="${ cx }" cy="${ cy }" r="${ r }" fill="var(--input-bg)"></circle>`;
		} else if ( 1 === withCount.length ) {
			const seg = withCount[ 0 ];
			svgBody = `<circle class="acp-chart-segment" data-tooltip="${ escAttr( tooltipFor( seg ) ) }" cx="${ cx }" cy="${ cy }" r="${ r }" fill="${ seg.color }"></circle>`;
		} else {
			let angle = -Math.PI / 2;
			svgBody = withCount
				.map( ( seg ) => {
					const slice = ( seg.count / totalCount ) * Math.PI * 2;
					const start = angle;
					const end = angle + slice;
					angle = end;
					return `<path class="acp-chart-segment" data-tooltip="${ escAttr( tooltipFor( seg ) ) }" d="${ arcPath( cx, cy, r, start, end ) }" fill="${ seg.color }" stroke="var(--card)" stroke-width="2"></path>`;
				} )
				.join( '' );
		}

		const legend = segments
			.map(
				( seg ) => `
			<div style="display:flex;align-items:center;gap:8px;font-size:12px">
				<span style="width:10px;height:10px;border-radius:3px;background:${ seg.color };flex:0 0 auto"></span>
				<span style="flex:1;color:var(--text-muted)">${ seg.label }</span>
				<span style="font-weight:700">${ seg.count } · ${ money( seg.value ) }</span>
			</div>
		`
			)
			.join( '' );

		return `
			<div style="display:flex;align-items:center;gap:28px;flex-wrap:wrap">
				<svg viewBox="0 0 180 180" width="180" height="180">${ svgBody }</svg>
				<div style="display:flex;flex-direction:column;gap:10px;min-width:180px">${ legend }</div>
			</div>
		`;
	}

	function vendorRowHtml( v ) {
		const isExpanded = v.id === expandedVendorId;
		return `
			<div>
				<div class="vr-vendor-row" data-vendor-row="${ escAttr( v.id ) }" style="display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid var(--border);cursor:pointer;background:${ isExpanded ? 'var(--input-bg)' : 'transparent' }">
					<div style="flex:1;min-width:0;font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${ esc( v.name ) }</div>
					<div style="font-size:11px;color:var(--text-muted)">${ v.salesCount } ${ 1 === v.salesCount ? 'venta' : 'ventas' } · ${ v.units } uds</div>
					<div style="text-align:right">
						<div style="font-size:13px;font-weight:700">${ money( v.revenue ) }</div>
						${ v.pending > 0 ? `<div style="font-size:10px;color:var(--text-faint2, var(--text-muted))">+ ${ money( v.pending ) } por cobrar</div>` : '' }
					</div>
				</div>
				${ isExpanded ? vendorItemsHtml( v ) : '' }
			</div>
		`;
	}

	function vendorItemsHtml( v ) {
		return `
			<div style="display:flex;flex-direction:column;gap:6px;padding:10px 0 4px">
				${ v.items
					.map(
						( it ) => `
					<div style="display:flex;align-items:center;gap:10px;font-size:12px">
						<div style="flex:1;min-width:0;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${ esc( it.name ) }${ it.detail ? ' · ' + esc( it.detail ) : '' } ×${ it.qty }</div>
						<div style="width:110px;flex:0 0 auto;color:var(--text-faint2, var(--text-muted));white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${ esc( it.customerName ) }</div>
						<div style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:20px;background:${ STATUS_META[ it.status ].color.replace( ')', ' / 0.15)' ) };color:${ STATUS_META[ it.status ].color };flex:0 0 auto">${ STATUS_META[ it.status ].label }</div>
						<div style="font-weight:700;flex:0 0 auto">${ money( it.price * it.qty ) }</div>
					</div>
				`
					)
					.join( '' ) }
			</div>
		`;
	}

	function extraMetricsHtml( stats ) {
		return `
			<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px;margin-bottom:20px">
				<div style="background:var(--card);border:1px solid var(--border);border-radius:14px;padding:22px">
					<div style="font-size:15px;font-weight:700;margin-bottom:4px">Desempeño por vendedor</div>
					<div style="font-size:12px;color:var(--text-faint2, var(--text-muted));margin-bottom:14px">El monto solo cuenta ventas Pagado (igual que "Ganancia" en el Dashboard) — click en un vendedor para ver qué vendió</div>
					${
						0 === stats.vendorRows.length
							? '<div style="font-size:13px;color:var(--text-muted)">Sin datos.</div>'
							: stats.vendorRows.map( vendorRowHtml ).join( '' )
					}
				</div>
				<div style="background:var(--card);border:1px solid var(--border);border-radius:14px;padding:22px">
					<div style="font-size:15px;font-weight:700;margin-bottom:4px">Talla/color más vendida</div>
					<div style="font-size:12px;color:var(--text-faint2, var(--text-muted));margin-bottom:14px">Para decidir qué reponer primero en la próxima carga</div>
					${
						0 === stats.topSizeColor.length
							? '<div style="font-size:13px;color:var(--text-muted)">Sin datos.</div>'
							: stats.topSizeColor
									.map(
										( sc ) => `
						<div style="display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid var(--border)">
							<div style="flex:1;min-width:0;font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${ esc( sc.name ) }${ sc.size ? ' · ' + esc( sc.size ) : '' }${ sc.color ? ' · ' + esc( sc.color ) : '' }</div>
							<div style="font-size:13px;font-weight:700">${ sc.qty } uds</div>
						</div>
					`
									)
									.join( '' )
					}
				</div>
			</div>
		`;
	}

	function customersHtml( customerRows ) {
		return `
			<div style="background:var(--card);border:1px solid var(--border);border-radius:14px;padding:22px">
				<div style="font-size:15px;font-weight:700;margin-bottom:4px">Clientes y prendas</div>
				<div style="font-size:12px;color:var(--text-faint2, var(--text-muted));margin-bottom:14px">Qué se llevó cada cliente en el período</div>
				<div style="display:flex;flex-direction:column;gap:14px">
					${ customerRows
						.map(
							( c ) => `
						<div style="border:1px solid var(--border);border-radius:10px;padding:12px">
							<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px">
								<div style="font-size:13px;font-weight:700">${ esc( c.name ) }</div>
								<div style="font-size:13px;font-weight:700">${ money( c.total ) }</div>
							</div>
							<div style="font-size:12px;color:var(--text-muted)">
								${ c.items.map( ( it ) => `${ esc( it.name ) }${ it.detail ? ' (' + esc( it.detail ) + ')' : '' } ×${ it.qty }` ).join( ', ' ) }
							</div>
						</div>
					`
						)
						.join( '' ) }
				</div>
			</div>
		`;
	}

	function wireEvents() {
		const fromSelect = document.getElementById( 'vr-from' );
		const toSelect = document.getElementById( 'vr-to' );
		if ( fromSelect ) {
			fromSelect.addEventListener( 'change', () => {
				fromMonth = fromSelect.value;
				load();
			} );
		}
		if ( toSelect ) {
			toSelect.addEventListener( 'change', () => {
				toMonth = toSelect.value;
				load();
			} );
		}

		main.querySelectorAll( '[data-status-card]' ).forEach( ( card ) => {
			card.addEventListener( 'click', () => {
				const key = card.dataset.statusCard;
				statusDetailFilter = statusDetailFilter === key ? null : key;
				draw();
			} );
		} );

		main.querySelectorAll( '[data-vendor-row]' ).forEach( ( row ) => {
			row.addEventListener( 'click', () => {
				const id = row.dataset.vendorRow;
				expandedVendorId = expandedVendorId === id ? null : id;
				draw();
			} );
		} );
	}
}

function rangeBounds( fromKey, toKey ) {
	const [ fy, fm ] = fromKey.split( '-' ).map( Number );
	const [ ty, tm ] = toKey.split( '-' ).map( Number );
	let start = new Date( fy, fm - 1, 1 );
	let end = new Date( ty, tm, 1 ); // primer día del mes SIGUIENTE al "hasta" (límite exclusivo)
	if ( start > end ) {
		start = new Date( ty, tm - 1, 1 );
		end = new Date( fy, fm, 1 );
	}
	return { start, end };
}

function monthKey( date ) {
	return date.getFullYear() + '-' + String( date.getMonth() + 1 ).padStart( 2, '0' );
}

function monthLabel( date ) {
	const label = date.toLocaleDateString( 'es-CL', { month: 'long', year: 'numeric' } );
	return label.charAt( 0 ).toUpperCase() + label.slice( 1 );
}

function polarToCartesian( cx, cy, r, angle ) {
	return { x: cx + r * Math.cos( angle ), y: cy + r * Math.sin( angle ) };
}

function arcPath( cx, cy, r, startAngle, endAngle ) {
	const start = polarToCartesian( cx, cy, r, startAngle );
	const end = polarToCartesian( cx, cy, r, endAngle );
	const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
	return `M ${ cx } ${ cy } L ${ start.x } ${ start.y } A ${ r } ${ r } 0 ${ largeArc } 1 ${ end.x } ${ end.y } Z`;
}

function money( n ) {
	return '$' + Number( n ).toLocaleString( 'es-CL', { maximumFractionDigits: 0 } );
}

function esc( str ) {
	const div = document.createElement( 'div' );
	div.textContent = str ?? '';
	return div.innerHTML;
}

function escAttr( val ) {
	return esc( String( val ?? '' ) );
}
