const MONTHLY_TREND_MAX_MONTHS = 12;
const MONTHLY_TREND_DEFAULT_MONTHS = 3;
const MONTH_LABEL_FORMAT = { month: 'short', year: '2-digit' };
const NO_SALES_RECENT_DAYS = 30;
const VOIDED_TOP_LIMIT = 10;

export function renderAnalitica( main, ctx ) {
	const { supabase, org } = ctx;
	let monthlyTrend = []; // hasta MONTHLY_TREND_MAX_MONTHS meses, viejo → nuevo
	let monthlyTrendMonths = MONTHLY_TREND_DEFAULT_MONTHS;
	let noSalesRecent = [];
	let noSalesAllTime = [];
	let noSalesRange = 'reciente'; // 'reciente' | 'historico'
	let soldCountRecent = 0;
	let soldCountAllTime = 0;
	let totalProducts = 0;
	let voidedByProduct = [];
	let voidedSummary = { count: 0, units: 0, total: 0 };
	let errorMsg = '';

	load();

	async function load() {
		main.innerHTML = '<div class="acp-empty-state">Cargando…</div>';

		const startOfMonth = new Date();
		startOfMonth.setDate( 1 );
		startOfMonth.setHours( 0, 0, 0, 0 );
		const trendStart = new Date( startOfMonth );
		trendStart.setMonth( trendStart.getMonth() - ( MONTHLY_TREND_MAX_MONTHS - 1 ) );

		const [ variantsRes, itemsRes, expensesRes ] = await Promise.all( [
			supabase.from( 'product_variants' ).select( 'product_id, stock_quantity, products ( name )' ).eq( 'organization_id', org.id ),
			// Todo el historial de sale_items, cualquier estado — de acá salen
			// las 3 secciones: comparativo mensual (solo pagado), qué no se
			// vendió (set de product_id con al menos una venta pagado) e
			// intentos de venta anulados (solo anulado).
			supabase
				.from( 'sale_items' )
				.select( 'quantity, unit_price, unit_cost, product_variants ( product_id, products ( name ) ), sales ( created_at, status )' )
				.eq( 'organization_id', org.id ),
			supabase
				.from( 'expenses' )
				.select( 'amount, expense_date' )
				.eq( 'organization_id', org.id )
				.gte( 'expense_date', ymd( trendStart ) ),
		] );

		if ( variantsRes.error || itemsRes.error || expensesRes.error ) {
			errorMsg = 'No se pudo cargar la analítica: ' + ( variantsRes.error || itemsRes.error || expensesRes.error ).message;
			draw();
			return;
		}

		const byProduct = new Map(); // product_id -> { name, stock }
		( variantsRes.data || [] ).forEach( ( v ) => {
			const entry = byProduct.get( v.product_id ) || { name: v.products?.name || 'Producto', stock: 0 };
			entry.stock += v.stock_quantity;
			byProduct.set( v.product_id, entry );
		} );
		totalProducts = byProduct.size;

		const items = itemsRes.data || [];
		buildMonthlyTrend( items, expensesRes.data || [], startOfMonth );
		buildNoSales( items, byProduct );
		buildVoidedByProduct( items );

		draw();
	}

	// Ganancia neta (ventas Pagado menos gastos) por mes, últimos
	// MONTHLY_TREND_MAX_MONTHS — se calcula todo de una vez y el selector
	// 3/6/12 meses solo recorta este mismo array, sin pedir nada de nuevo.
	function buildMonthlyTrend( items, expenses, currentMonthStart ) {
		const months = [];
		for ( let i = MONTHLY_TREND_MAX_MONTHS - 1; i >= 0; i-- ) {
			const d = new Date( currentMonthStart );
			d.setMonth( d.getMonth() - i );
			months.push( { key: monthKey( d ), label: d.toLocaleDateString( 'es-CL', MONTH_LABEL_FORMAT ), sold: 0, profit: 0, expenses: 0 } );
		}
		const byKey = new Map( months.map( ( m ) => [ m.key, m ] ) );

		items
			.filter( ( it ) => 'pagado' === it.sales?.status && it.sales?.created_at )
			.forEach( ( it ) => {
				const bucket = byKey.get( monthKey( new Date( it.sales.created_at ) ) );
				if ( ! bucket ) return; // fuera de los últimos 12 meses
				bucket.sold += it.unit_price * it.quantity;
				bucket.profit += ( it.unit_price - it.unit_cost ) * it.quantity;
			} );

		expenses.forEach( ( e ) => {
			// expense_date es "date" pura (YYYY-MM-DD) — se arma la clave del
			// mes directo del string, sin pasar por Date() (evita el mismo
			// corrimiento de zona horaria que ya tuvimos con toISOString()).
			const bucket = byKey.get( e.expense_date.slice( 0, 7 ) );
			if ( ! bucket ) return;
			bucket.expenses += Number( e.amount );
		} );

		monthlyTrend = months.map( ( m ) => ( { ...m, netProfit: m.profit - m.expenses } ) );
	}

	// Productos con stock que NO tuvieron ninguna venta Pagado en el rango —
	// dead stock candidato a descuento o dejar de reponer. Se calculan los
	// dos rangos (30 días / histórico) de una sola pasada.
	function buildNoSales( items, byProduct ) {
		const recentCutoff = new Date();
		recentCutoff.setDate( recentCutoff.getDate() - ( NO_SALES_RECENT_DAYS - 1 ) );
		recentCutoff.setHours( 0, 0, 0, 0 );

		const soldRecent = new Set();
		const soldAllTime = new Set();

		items
			.filter( ( it ) => 'pagado' === it.sales?.status )
			.forEach( ( it ) => {
				const productId = it.product_variants?.product_id;
				if ( ! productId ) return;
				soldAllTime.add( productId );
				if ( it.sales?.created_at && new Date( it.sales.created_at ) >= recentCutoff ) {
					soldRecent.add( productId );
				}
			} );

		soldCountRecent = soldRecent.size;
		soldCountAllTime = soldAllTime.size;

		const entries = Array.from( byProduct.entries() );
		noSalesRecent = entries.filter( ( [ id ] ) => ! soldRecent.has( id ) ).map( ( [ , v ] ) => v );
		noSalesAllTime = entries.filter( ( [ id ] ) => ! soldAllTime.has( id ) ).map( ( [ , v ] ) => v );
	}

	// Ventas que se intentaron pero se anularon — agrupado por producto,
	// para notar patrones (ej. un producto que siempre termina anulado
	// puede indicar un problema real: talla, calidad, precio, lo que sea).
	function buildVoidedByProduct( items ) {
		const voided = items.filter( ( it ) => 'anulado' === it.sales?.status );
		const byProduct = new Map(); // product_id -> { name, count, units, total }

		voided.forEach( ( it ) => {
			const productId = it.product_variants?.product_id;
			const name = it.product_variants?.products?.name;
			if ( ! productId || ! name ) return;
			const entry = byProduct.get( productId ) || { name, count: 0, units: 0, total: 0 };
			entry.count += 1;
			entry.units += it.quantity;
			entry.total += it.quantity * it.unit_price;
			byProduct.set( productId, entry );
		} );

		voidedByProduct = Array.from( byProduct.values() )
			.sort( ( a, b ) => b.total - a.total )
			.slice( 0, VOIDED_TOP_LIMIT );

		voidedSummary = voided.reduce(
			( acc, it ) => ( { count: acc.count + 1, units: acc.units + it.quantity, total: acc.total + it.quantity * it.unit_price } ),
			{ count: 0, units: 0, total: 0 }
		);
	}

	function draw() {
		main.innerHTML = `
			<div style="margin-bottom:24px">
				<div style="font-size:24px;font-weight:800;letter-spacing:-0.01em">Analítica</div>
				<div style="font-size:14px;color:var(--text-muted);margin-top:4px">Qué se vendió, qué no, y dónde se están perdiendo ventas — para apoyar decisiones, no el día a día operativo.</div>
			</div>
			${ errorMsg ? `<div class="acp-error">${ esc( errorMsg ) }</div>` : '' }
			${ monthlyTrendHtml() }
			${ noSalesHtml() }
			${ voidedHtml() }
		`;

		wireEvents();
	}

	function wireEvents() {
		main.querySelectorAll( '.mt-range-btn' ).forEach( ( btn ) => {
			btn.addEventListener( 'click', () => {
				monthlyTrendMonths = Number( btn.dataset.months );
				draw();
			} );
		} );
		main.querySelectorAll( '.ns-range-btn' ).forEach( ( btn ) => {
			btn.addEventListener( 'click', () => {
				noSalesRange = btn.dataset.range;
				draw();
			} );
		} );
	}

	function monthlyTrendHtml() {
		const shown = monthlyTrend.slice( -monthlyTrendMonths );
		const maxAbs = Math.max( 1, ...shown.map( ( m ) => Math.abs( m.netProfit ) ) );

		return `
			<div class="acp-viz-root" style="margin-bottom:24px">
				<div style="background:var(--card);border:1px solid var(--border);border-radius:14px;padding:22px">
					<div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:18px;flex-wrap:wrap;gap:10px">
						<div>
							<div style="font-size:15px;font-weight:700">Comparativo mensual</div>
							<div style="font-size:12px;color:var(--text-faint2, var(--text-muted));margin-top:2px">Ganancia neta (ventas Pagado − gastos) por mes</div>
						</div>
						<div style="display:flex;gap:4px;background:var(--input-bg);border-radius:9px;padding:3px">
							${ [ 3, 6, 12 ]
								.map(
									( n ) => `
								<button type="button" class="mt-range-btn" data-months="${ n }" style="padding:7px 14px;border-radius:7px;border:none;cursor:pointer;font-size:12px;font-weight:700;font-family:inherit;background:${ n === monthlyTrendMonths ? 'var(--accent)' : 'transparent' };color:${ n === monthlyTrendMonths ? 'var(--accent-contrast)' : 'var(--text-muted)' }">${ n } meses</button>
							`
								)
								.join( '' ) }
						</div>
					</div>
					<div style="display:flex;align-items:stretch;gap:${ shown.length > 6 ? '4px' : '10px' };height:200px">
						${ shown.map( ( m ) => monthBarHtml( m, maxAbs ) ).join( '' ) }
					</div>
				</div>
			</div>
		`;
	}

	function monthBarHtml( m, maxAbs ) {
		const isPositive = m.netProfit >= 0;
		const heightPct = 0 === maxAbs ? 0 : Math.min( 100, Math.round( ( Math.abs( m.netProfit ) / maxAbs ) * 100 ) );
		const color = isPositive ? 'oklch(0.72 0.16 152)' : 'oklch(0.65 0.18 25)';
		const tooltip = `${ m.label }: ventas ${ money( m.sold ) }, ganancia neta ${ money( m.netProfit ) }`;

		return `
			<div style="flex:1;min-width:0;display:flex;flex-direction:column">
				<div style="height:50%;display:flex;align-items:flex-end;justify-content:center">
					${
						isPositive
							? `<div class="acp-chart-segment" data-tooltip="${ escAttr( tooltip ) }" style="width:70%;max-width:28px;height:${ heightPct }%;background:${ color };border-radius:4px 4px 0 0"></div>`
							: ''
					}
				</div>
				<div style="height:50%;display:flex;align-items:flex-start;justify-content:center;border-top:1px solid var(--border)">
					${
						isPositive
							? ''
							: `<div class="acp-chart-segment" data-tooltip="${ escAttr( tooltip ) }" style="width:70%;max-width:28px;height:${ heightPct }%;background:${ color };border-radius:0 0 4px 4px"></div>`
					}
				</div>
				<div style="font-size:10px;color:var(--text-faint2, var(--text-muted));margin-top:8px;text-align:center;white-space:nowrap">${ esc( m.label ) }</div>
			</div>
		`;
	}

	function noSalesHtml() {
		const list = 'reciente' === noSalesRange ? noSalesRecent : noSalesAllTime;
		const soldCount = 'reciente' === noSalesRange ? soldCountRecent : soldCountAllTime;

		return `
			<div style="background:var(--card);border:1px solid var(--border);border-radius:14px;padding:22px;margin-bottom:24px">
				<div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:6px;flex-wrap:wrap;gap:10px">
					<div>
						<div style="font-size:15px;font-weight:700">Productos sin ventas</div>
						<div style="font-size:12px;color:var(--text-faint2, var(--text-muted));margin-top:2px">Tienen stock pero no se vendieron (Pagado) en el período — candidatos a descuento o dejar de reponer</div>
					</div>
					<div style="display:flex;gap:4px;background:var(--input-bg);border-radius:9px;padding:3px">
						<button type="button" class="ns-range-btn" data-range="reciente" style="padding:7px 14px;border-radius:7px;border:none;cursor:pointer;font-size:12px;font-weight:700;font-family:inherit;background:${ 'reciente' === noSalesRange ? 'var(--accent)' : 'transparent' };color:${ 'reciente' === noSalesRange ? 'var(--accent-contrast)' : 'var(--text-muted)' }">Últimos ${ NO_SALES_RECENT_DAYS } días</button>
						<button type="button" class="ns-range-btn" data-range="historico" style="padding:7px 14px;border-radius:7px;border:none;cursor:pointer;font-size:12px;font-weight:700;font-family:inherit;background:${ 'historico' === noSalesRange ? 'var(--accent)' : 'transparent' };color:${ 'historico' === noSalesRange ? 'var(--accent-contrast)' : 'var(--text-muted)' }">Histórico</button>
					</div>
				</div>
				<div style="font-size:12px;color:var(--text-muted);margin-bottom:14px">${ soldCount } de ${ totalProducts } productos tuvieron al menos una venta en este período.</div>
				<div style="display:flex;flex-direction:column;gap:4px">
					${
						0 === list.length
							? '<div style="font-size:13px;color:var(--text-muted)">Todos los productos tuvieron ventas en este período.</div>'
							: list
									.map(
										( p ) => `
						<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--border)">
							<div style="flex:1;min-width:0;font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${ esc( p.name ) }</div>
							<div style="font-size:12px;color:var(--text-faint2, var(--text-muted))">${ p.stock } en stock</div>
						</div>
					`
									)
									.join( '' )
					}
				</div>
			</div>
		`;
	}

	function voidedHtml() {
		return `
			<div style="background:var(--card);border:1px solid var(--border);border-radius:14px;padding:22px;margin-bottom:24px">
				<div style="font-size:15px;font-weight:700">Intentos de venta anulados</div>
				<div style="font-size:12px;color:var(--text-faint2, var(--text-muted));margin-top:2px;margin-bottom:14px">Ventas que se registraron y después se anularon — histórico completo, por producto</div>
				<div style="font-size:12px;color:var(--text-muted);margin-bottom:14px">${ voidedSummary.count } ventas anuladas en total · ${ voidedSummary.units } unidades · ${ money( voidedSummary.total ) }</div>
				<div style="display:flex;flex-direction:column;gap:4px">
					${
						0 === voidedByProduct.length
							? '<div style="font-size:13px;color:var(--text-muted)">Todavía no hay ventas anuladas.</div>'
							: voidedByProduct
									.map(
										( p ) => `
						<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--border)">
							<div style="flex:1;min-width:0;font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${ esc( p.name ) }</div>
							<div style="font-size:12px;color:var(--text-faint2, var(--text-muted))">${ p.count } ${ 1 === p.count ? 'vez' : 'veces' } · ${ p.units } uds</div>
							<div style="font-size:14px;font-weight:700;color:oklch(0.65 0.18 25)">${ money( p.total ) }</div>
						</div>
					`
									)
									.join( '' )
					}
				</div>
			</div>
		`;
	}
}

function monthKey( date ) {
	return date.getFullYear() + '-' + String( date.getMonth() + 1 ).padStart( 2, '0' );
}

function ymd( date ) {
	const y = date.getFullYear();
	const m = String( date.getMonth() + 1 ).padStart( 2, '0' );
	const d = String( date.getDate() ).padStart( 2, '0' );
	return `${ y }-${ m }-${ d }`;
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
