// Paleta categórica validada (skill de dataviz) para el gráfico de vendedores
// — orden fijo, nunca se reciclan colores. Se salta el slot "verde" (#008300)
// porque coincide con nuestro acento (que ya significa "positivo/ganancia" en
// el resto de la app) y usarlo de nuevo como color de serie confundiría.
const VENDOR_COLORS = [ '#3987e5', '#199e70', '#c98500', '#9085e9', '#e66767' ];
const CHART_DAYS = 14;
const TOP_PRODUCTS_LIMIT = 5;
const TOP_PRODUCTS_RECENT_DAYS = 30;
const DEFAULT_LOW_STOCK_THRESHOLD = 1; // por si algún producto viejo no tiene el campo
const MAX_STOCK_ITEMS_PER_KIND = 2;
const MONTHLY_TREND_MAX_MONTHS = 12;
const MONTHLY_TREND_DEFAULT_MONTHS = 3;
const MONTH_LABEL_FORMAT = { month: 'short', year: '2-digit' };

// Mismos colores que usa el "Centro de Recomendaciones" de ACP Core (WordPress)
// — se reutilizan tal cual para que la idea se sienta igual entre las dos apps.
const SEVERITY_COLOR = {
	success: 'oklch(0.72 0.16 152)',
	warning: 'oklch(0.75 0.16 95)',
	danger: 'oklch(0.68 0.18 25)',
	info: 'oklch(0.72 0.13 230)',
};

export function renderDashboard( main, ctx ) {
	const { supabase, org, navigateTo, canSeeProductos, canSeeGastos } = ctx;
	let stats = null;
	let chartDays = [];
	let chartVendors = [];
	let topProductsAllTime = [];
	let topProductsRecent = [];
	let topProductsRange = 'historico'; // 'historico' | 'reciente'
	let recommendations = [];
	let monthlyTrend = []; // hasta MONTHLY_TREND_MAX_MONTHS meses, viejo → nuevo
	let monthlyTrendMonths = MONTHLY_TREND_DEFAULT_MONTHS;
	let errorMsg = '';

	load();

	async function load() {
		main.innerHTML = '<div class="acp-empty-state">Cargando…</div>';

		const startOfMonth = new Date();
		startOfMonth.setDate( 1 );
		startOfMonth.setHours( 0, 0, 0, 0 );
		const startOfLastMonth = new Date( startOfMonth );
		startOfLastMonth.setMonth( startOfLastMonth.getMonth() - 1 );
		const startOfDay = new Date();
		startOfDay.setHours( 0, 0, 0, 0 );
		const chartStart = new Date();
		chartStart.setDate( chartStart.getDate() - ( CHART_DAYS - 1 ) );
		chartStart.setHours( 0, 0, 0, 0 );
		// La ventana de la consulta de ventas tiene que cubrir lo que pida el
		// rango más amplio de los tres: el gráfico, el mes actual, o la
		// comparación con el mes pasado (para "ventas creciendo").
		const earliestNeeded = new Date( Math.min( chartStart, startOfMonth, startOfLastMonth ) );
		// Para el comparativo mensual — se trae de una vez el máximo rango que
		// se puede seleccionar (12 meses) y el selector de 3/6/12 solo recorta
		// ese mismo array ya calculado, sin volver a pedir nada.
		const trendStart = new Date( startOfMonth );
		trendStart.setMonth( trendStart.getMonth() - ( MONTHLY_TREND_MAX_MONTHS - 1 ) );

		const [ variantsRes, salesRes, topSalesRes, receivableRes, expensesRes, membersRes ] = await Promise.all( [
			supabase.from( 'product_variants' ).select( 'size, color, cost, price, stock_quantity, products ( name, low_stock_threshold )' ).eq( 'organization_id', org.id ),
			supabase
				.from( 'sales' )
				.select( 'created_at, vendor_id, status, total_amount, sale_items ( quantity, unit_price, unit_cost )' )
				.eq( 'organization_id', org.id )
				.gte( 'created_at', earliestNeeded.toISOString() ),
			supabase
				.from( 'sale_items' )
				.select( 'quantity, unit_price, unit_cost, product_variants ( product_id, products ( name ) ), sales ( created_at, status )' )
				.eq( 'organization_id', org.id ),
			// "Por cobrar": ventas en pre-venta/crédito, sin importar cuándo se
			// hicieron — es plata pendiente de hoy, no un corte por fecha.
			supabase
				.from( 'sales' )
				.select( 'total_amount' )
				.eq( 'organization_id', org.id )
				.in( 'status', [ 'pre_venta', 'credito' ] ),
			supabase
				.from( 'expenses' )
				.select( 'amount, expense_date' )
				.eq( 'organization_id', org.id )
				.gte( 'expense_date', ymd( trendStart ) ),
			supabase.from( 'memberships' ).select( 'user_id, full_name' ).eq( 'organization_id', org.id ),
		] );

		if ( variantsRes.error || salesRes.error || topSalesRes.error || receivableRes.error || expensesRes.error ) {
			errorMsg = 'No se pudo cargar el Dashboard: ' + ( variantsRes.error || salesRes.error || topSalesRes.error || receivableRes.error || expensesRes.error ).message;
			draw();
			return;
		}

		let invested = 0;
		let potentialProfit = 0;
		const criticalVariants = [];
		const outOfStockVariants = [];
		( variantsRes.data || [] ).forEach( ( v ) => {
			invested += v.cost * v.stock_quantity;
			potentialProfit += ( v.price - v.cost ) * v.stock_quantity;

			const label = ( v.products?.name || 'Producto' ) + ( v.size ? ` (${ v.size }${ v.color ? ' · ' + v.color : '' })` : '' );
			const threshold = v.products?.low_stock_threshold ?? DEFAULT_LOW_STOCK_THRESHOLD;
			if ( 0 === v.stock_quantity ) {
				outOfStockVariants.push( label );
			} else if ( v.stock_quantity < threshold ) {
				criticalVariants.push( { label, threshold } );
			}
		} );

		const memberNames = new Map( ( membersRes.data || [] ).map( ( m ) => [ m.user_id, m.full_name ] ) );

		let todaySold = 0;
		let todayProfit = 0;
		let monthSold = 0;
		let monthProfit = 0;
		let lastMonthSold = 0;
		const dayVendorQty = new Map(); // "YYYY-MM-DD|vendorId" -> qty

		// Pre-venta/crédito ya descontaron stock pero todavía no son plata
		// cobrada, y anulado se revirtió — solo pagado cuenta como venta real
		// para estos montos y para el gráfico de actividad.
		( salesRes.data || [] ).filter( ( s ) => 'pagado' === s.status ).forEach( ( s ) => {
			const saleDate = new Date( s.created_at );
			const isToday = saleDate >= startOfDay;
			const isThisMonth = saleDate >= startOfMonth;
			const isLastMonth = saleDate >= startOfLastMonth && saleDate < startOfMonth;
			const dayKey = ymd( saleDate );

			( s.sale_items || [] ).forEach( ( it ) => {
				const sold = it.unit_price * it.quantity;
				const profit = ( it.unit_price - it.unit_cost ) * it.quantity;
				if ( isThisMonth ) {
					monthSold += sold;
					monthProfit += profit;
				}
				if ( isLastMonth ) {
					lastMonthSold += sold;
				}
				if ( isToday ) {
					todaySold += sold;
					todayProfit += profit;
				}
				if ( saleDate >= chartStart ) {
					const key = dayKey + '|' + s.vendor_id;
					dayVendorQty.set( key, ( dayVendorQty.get( key ) || 0 ) + it.quantity );
				}
			} );
		} );

		// expense_date es una columna "date" pura (sin hora) — comparar como
		// string evita el mismo lío de zona horaria que ya tuvimos con
		// toISOString() en otro lado (new Date('2026-09-01') se interpreta
		// como medianoche UTC, no medianoche local, y puede correr el corte
		// un día para atrás en zonas horarias detrás de UTC como Chile).
		const startOfMonthStr = ymd( startOfMonth );
		const monthExpenses = ( expensesRes.data || [] )
			.filter( ( e ) => e.expense_date >= startOfMonthStr )
			.reduce( ( sum, e ) => sum + Number( e.amount ), 0 );
		const receivable = ( receivableRes.data || [] ).reduce( ( sum, s ) => sum + Number( s.total_amount ), 0 );

		// Cuánto se anuló este mes — mismo rango que ya trae salesRes, así
		// que se aprovecha esa misma consulta en vez de pedir otra.
		const voidedThisMonth = ( salesRes.data || [] )
			.filter( ( s ) => 'anulado' === s.status && new Date( s.created_at ) >= startOfMonth )
			.reduce( ( sum, s ) => sum + Number( s.total_amount ), 0 );

		stats = {
			invested,
			potentialProfit,
			todaySold,
			todayProfit,
			monthSold,
			monthProfit,
			lastMonthSold,
			monthExpenses,
			netMonthProfit: monthProfit - monthExpenses,
			receivable,
			voidedThisMonth,
		};

		buildChartData( dayVendorQty, memberNames, chartStart );
		buildTopProducts( topSalesRes.data || [] );
		buildRecommendations( criticalVariants, outOfStockVariants );
		buildMonthlyTrend( topSalesRes.data || [], expensesRes.data || [], startOfMonth );

		draw();
	}

	// Ganancia neta (utilidad de ventas Pagado, menos gastos) por mes, para
	// los últimos MONTHLY_TREND_MAX_MONTHS — se calcula todo de una vez acá
	// y el selector 3/6/12 meses de la UI solo recorta este mismo array,
	// sin volver a pedir nada a la red.
	function buildMonthlyTrend( saleItems, expenses, currentMonthStart ) {
		const months = [];
		for ( let i = MONTHLY_TREND_MAX_MONTHS - 1; i >= 0; i-- ) {
			const d = new Date( currentMonthStart );
			d.setMonth( d.getMonth() - i );
			months.push( { key: monthKey( d ), label: d.toLocaleDateString( 'es-CL', MONTH_LABEL_FORMAT ), sold: 0, profit: 0, expenses: 0 } );
		}
		const byKey = new Map( months.map( ( m ) => [ m.key, m ] ) );

		saleItems
			.filter( ( it ) => 'pagado' === it.sales?.status && it.sales?.created_at )
			.forEach( ( it ) => {
				const bucket = byKey.get( monthKey( new Date( it.sales.created_at ) ) );
				if ( ! bucket ) return; // fuera de los últimos 12 meses
				bucket.sold += it.unit_price * it.quantity;
				bucket.profit += ( it.unit_price - it.unit_cost ) * it.quantity;
			} );

		expenses.forEach( ( e ) => {
			// expense_date es "date" pura (YYYY-MM-DD) — se arma la clave del
			// mes directo del string, sin pasar por Date() (mismo motivo que
			// en monthExpenses: evitar el corrimiento de zona horaria).
			const bucket = byKey.get( e.expense_date.slice( 0, 7 ) );
			if ( ! bucket ) return;
			bucket.expenses += Number( e.amount );
		} );

		monthlyTrend = months.map( ( m ) => ( { ...m, netProfit: m.profit - m.expenses } ) );
	}

	// Calcula el ranking dos veces: todo el historial (mismo criterio que
	// "Productos más vendidos" en ACP Core) y solo los últimos N días — el
	// selector de la UI elige cuál mostrar, ambos ya quedan calculados acá
	// para que cambiar de uno a otro sea instantáneo (sin ir a la red).
	function buildTopProducts( items ) {
		const recentCutoff = new Date();
		recentCutoff.setDate( recentCutoff.getDate() - ( TOP_PRODUCTS_RECENT_DAYS - 1 ) );
		recentCutoff.setHours( 0, 0, 0, 0 );

		function aggregate( list ) {
			const byProduct = new Map(); // product_id -> { name, sold, revenue }
			list.forEach( ( it ) => {
				const productId = it.product_variants?.product_id;
				const name = it.product_variants?.products?.name;
				if ( ! productId || ! name ) return;

				const entry = byProduct.get( productId ) || { name, sold: 0, revenue: 0 };
				entry.sold += it.quantity;
				entry.revenue += it.quantity * it.unit_price;
				byProduct.set( productId, entry );
			} );

			return Array.from( byProduct.values() )
				.sort( ( a, b ) => b.sold - a.sold )
				.slice( 0, TOP_PRODUCTS_LIMIT );
		}

		// Solo ventas Pagado — pre-venta/crédito todavía no son plata cobrada
		// y anulado se revirtió, así que no cuentan como "vendido".
		const paidItems = items.filter( ( it ) => 'pagado' === it.sales?.status );
		topProductsAllTime = aggregate( paidItems );
		topProductsRecent = aggregate( paidItems.filter( ( it ) => it.sales?.created_at && new Date( it.sales.created_at ) >= recentCutoff ) );
	}

	// Adaptación del "Centro de Recomendaciones" de ACP Core (WordPress) —
	// mismas reglas de stock/ventas donde aplican; se deja fuera la de
	// "pedidos pendientes" porque acá una venta se registra completa, no
	// queda un estado intermedio por despachar. Se suma una nueva sobre
	// ganancia neta, que ACP Core no tiene porque no lleva gastos.
	function buildRecommendations( criticalVariants, outOfStockVariants ) {
		const recs = [];

		if ( 0 === criticalVariants.length && 0 === outOfStockVariants.length ) {
			recs.push( { severity: 'success', text: 'Todo el stock está en niveles normales.' } );
		} else {
			criticalVariants.slice( 0, MAX_STOCK_ITEMS_PER_KIND ).forEach( ( { label, threshold } ) => {
				recs.push( { severity: 'warning', text: `"${ label }" tiene menos de ${ threshold } unidades.` } );
			} );
			outOfStockVariants.slice( 0, MAX_STOCK_ITEMS_PER_KIND ).forEach( ( label ) => {
				recs.push( { severity: 'danger', text: `"${ label }" está agotado.` } );
			} );
		}

		if ( stats.monthSold > stats.lastMonthSold ) {
			recs.push( { severity: 'info', text: 'Tus ventas este mes ya superaron las del mes pasado.' } );
		}

		if ( stats.netMonthProfit < 0 ) {
			recs.push( { severity: 'danger', text: 'Los gastos de este mes superan la utilidad de las ventas — la ganancia neta va en negativo.' } );
		}

		recommendations = recs;
	}

	function buildChartData( dayVendorQty, memberNames, chartStart ) {
		const vendorIdsPresent = new Set();
		dayVendorQty.forEach( ( qty, key ) => vendorIdsPresent.add( key.split( '|' )[ 1 ] ) );

		chartVendors = Array.from( vendorIdsPresent )
			.map( ( id ) => ( { id, name: memberNames.get( id ) || 'Ex-usuario' } ) )
			.sort( ( a, b ) => a.name.localeCompare( b.name ) )
			.slice( 0, VENDOR_COLORS.length )
			.map( ( v, i ) => ( { ...v, color: VENDOR_COLORS[ i ] } ) );

		const days = [];
		for ( let i = 0; i < CHART_DAYS; i++ ) {
			const d = new Date( chartStart );
			d.setDate( d.getDate() + i );
			const key = ymd( d );
			const segments = chartVendors
				.map( ( v ) => ( { vendor: v, qty: dayVendorQty.get( key + '|' + v.id ) || 0 } ) )
				.filter( ( s ) => s.qty > 0 );
			const total = segments.reduce( ( sum, s ) => sum + s.qty, 0 );
			days.push( { label: date_i18n( d ), total, segments } );
		}
		chartDays = days;
	}

	function draw() {
		if ( ! stats ) {
			main.innerHTML = errorMsg ? `<div class="acp-error">${ esc( errorMsg ) }</div>` : '<div class="acp-empty-state">Cargando…</div>';
			return;
		}

		main.innerHTML = `
			<div style="margin-bottom:24px">
				<div style="font-size:24px;font-weight:800;letter-spacing:-0.01em">Dashboard</div>
			</div>
			${ errorMsg ? `<div class="acp-error">${ esc( errorMsg ) }</div>` : '' }

			<div style="font-size:13px;font-weight:700;color:var(--text-muted);margin-bottom:10px">Inventario actual</div>
			<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;margin-bottom:28px">
				${ statCard(
					'Monto invertido',
					money( stats.invested ),
					'Costo de todo tu stock actual' + ( canSeeProductos ? ' — click para ver el detalle' : '' ),
					canSeeProductos ? 'productos' : null
				) }
				${ statCard( 'Ganancia potencial', money( stats.potentialProfit ), 'Si vendes todo el stock actual a precio de lista', canSeeProductos ? 'productos' : null ) }
			</div>

			<div style="font-size:13px;font-weight:700;color:var(--text-muted);margin-bottom:10px">Ventas</div>
			<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;margin-bottom:28px">
				${ splitStatCard( 'Ventas de hoy', stats.todaySold, stats.todayProfit, 'ventas', { range: 'hoy' } ) }
				${ splitStatCard( 'Ventas del mes', stats.monthSold, stats.monthProfit, 'ventas', { range: 'mes' } ) }
				${ statCard(
					'Por cobrar',
					money( stats.receivable ),
					'Pre-venta y crédito pendientes de pago — click para ver cuáles',
					'ventas',
					{ range: 'todos' },
					stats.receivable > 0 ? 'oklch(0.75 0.16 95)' : undefined
				) }
				${ statCard(
					'Devuelto este mes',
					money( stats.voidedThisMonth ),
					'Ventas anuladas — click para ver el detalle',
					'ventas',
					{ range: 'mes', status: 'anulado' },
					stats.voidedThisMonth > 0 ? 'oklch(0.65 0.18 25)' : undefined
				) }
			</div>

			<div style="font-size:13px;font-weight:700;color:var(--text-muted);margin-bottom:10px">Gastos y ganancia neta (este mes)</div>
			<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;margin-bottom:28px">
				${ statCard(
					'Gastos del mes',
					money( stats.monthExpenses ),
					canSeeGastos ? 'Click para ver o registrar gastos' : '',
					canSeeGastos ? 'gastos' : null
				) }
				${ statCard(
					'Ganancia neta del mes',
					money( stats.netMonthProfit ),
					'Utilidad de ventas menos gastos',
					canSeeGastos ? 'gastos' : null,
					null,
					stats.netMonthProfit >= 0 ? 'oklch(0.72 0.16 152)' : 'oklch(0.65 0.18 25)'
				) }
			</div>

			${ recommendationsHtml() }
			${ topProductsHtml() }
			${ monthlyTrendHtml() }
			${ chartHtml() }
		`;

		main.querySelectorAll( '[data-goto]' ).forEach( ( el ) => {
			el.addEventListener( 'click', () => {
				const params = el.dataset.params ? JSON.parse( el.dataset.params ) : null;
				navigateTo( el.dataset.goto, params );
			} );
		} );

		main.querySelectorAll( '.tp-range-btn' ).forEach( ( btn ) => {
			btn.addEventListener( 'click', () => {
				topProductsRange = btn.dataset.range;
				draw();
			} );
		} );

		main.querySelectorAll( '.mt-range-btn' ).forEach( ( btn ) => {
			btn.addEventListener( 'click', () => {
				monthlyTrendMonths = Number( btn.dataset.months );
				draw();
			} );
		} );
	}

	function statCard( label, value, hint, goto, params, color ) {
		const clickable = Boolean( goto );
		return `
			<div style="background:var(--card);border:1px solid var(--border);border-radius:14px;padding:20px;${ clickable ? 'cursor:pointer;' : '' }transition:border-color 0.15s ease" class="${ clickable ? 'acp-kpi-card' : '' }" ${ clickable ? `data-goto="${ goto }"` : '' } ${ params ? `data-params='${ JSON.stringify( params ) }'` : '' }>
				<div style="font-size:13px;color:var(--text-muted);font-weight:600;margin-bottom:10px">${ esc( label ) }</div>
				<div style="font-size:24px;font-weight:800;letter-spacing:-0.01em${ color ? `;color:${ color }` : '' }">${ value }</div>
				${ hint ? `<div style="font-size:11px;color:var(--text-faint2, var(--text-muted));margin-top:6px">${ esc( hint ) }</div>` : '' }
			</div>
		`;
	}

	function splitStatCard( label, sold, profit, goto, params ) {
		return `
			<div style="background:var(--card);border:1px solid var(--border);border-radius:14px;padding:20px;cursor:pointer" class="acp-kpi-card" data-goto="${ goto }" data-params='${ JSON.stringify( params ) }'>
				<div style="font-size:13px;color:var(--text-muted);font-weight:600;margin-bottom:12px">${ esc( label ) }</div>
				<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px">
					<span style="font-size:12px;color:var(--text-muted)">Vendido</span>
					<span style="font-size:18px;font-weight:800">${ money( sold ) }</span>
				</div>
				<div style="display:flex;justify-content:space-between;align-items:baseline">
					<span style="font-size:12px;color:var(--text-muted)">Utilidad</span>
					<span style="font-size:15px;font-weight:700;color:oklch(0.72 0.16 152)">${ money( profit ) }</span>
				</div>
			</div>
		`;
	}

	function recommendationsHtml() {
		if ( 0 === recommendations.length ) return '';
		return `
			<div style="background:linear-gradient(135deg, oklch(0.22 0.03 152 / 0.5), var(--card));border:1px solid oklch(0.72 0.16 152 / 0.3);border-radius:16px;padding:24px;margin-bottom:24px">
				<div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">
					<div style="font-size:16px;font-weight:800;letter-spacing:-0.01em">Centro de Recomendaciones</div>
					<div style="font-size:11px;font-weight:700;color:oklch(0.72 0.16 152);background:oklch(0.72 0.16 152 / 0.15);padding:3px 8px;border-radius:20px">reglas activas</div>
				</div>
				<div style="display:flex;flex-direction:column;gap:10px">
					${ recommendations
						.map(
							( rec ) => `
						<div style="display:flex;align-items:flex-start;gap:12px;background:oklch(0.18 0.013 255 / 0.6);border-radius:10px;padding:12px 14px">
							<div style="width:10px;height:10px;border-radius:50%;margin-top:4px;flex:0 0 auto;background:${ SEVERITY_COLOR[ rec.severity ] || SEVERITY_COLOR.info }"></div>
							<div style="font-size:14px;color:var(--text-2, var(--text));line-height:1.5">${ esc( rec.text ) }</div>
						</div>
					`
						)
						.join( '' ) }
				</div>
			</div>
		`;
	}

	function topProductsHtml() {
		const activeProducts = 'reciente' === topProductsRange ? topProductsRecent : topProductsAllTime;
		return `
			<div style="background:var(--card);border:1px solid var(--border);border-radius:14px;padding:22px;margin-bottom:24px">
				<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px">
					<div style="font-size:15px;font-weight:700">Productos más vendidos</div>
					<div style="display:flex;gap:4px;background:var(--input-bg);border-radius:9px;padding:3px">
						<button type="button" class="tp-range-btn" data-range="historico" style="padding:7px 14px;border-radius:7px;border:none;cursor:pointer;font-size:12px;font-weight:700;font-family:inherit;background:${ 'historico' === topProductsRange ? 'var(--accent)' : 'transparent' };color:${ 'historico' === topProductsRange ? 'var(--accent-contrast)' : 'var(--text-muted)' }">Histórico</button>
						<button type="button" class="tp-range-btn" data-range="reciente" style="padding:7px 14px;border-radius:7px;border:none;cursor:pointer;font-size:12px;font-weight:700;font-family:inherit;background:${ 'reciente' === topProductsRange ? 'var(--accent)' : 'transparent' };color:${ 'reciente' === topProductsRange ? 'var(--accent-contrast)' : 'var(--text-muted)' }">Últimos ${ TOP_PRODUCTS_RECENT_DAYS } días</button>
					</div>
				</div>
				<div style="display:flex;flex-direction:column;gap:4px">
					${
						0 === activeProducts.length
							? '<div style="font-size:13px;color:var(--text-muted)">Todavía no hay ventas suficientes en este rango.</div>'
							: activeProducts
									.map(
										( p ) => `
						<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--border)">
							<div style="flex:1;min-width:0;font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${ esc( p.name ) }</div>
							<div style="font-size:12px;color:var(--text-faint2, var(--text-muted))">${ p.sold } vendidos</div>
							<div style="font-size:14px;font-weight:700">${ money( p.revenue ) }</div>
						</div>
					`
									)
									.join( '' )
					}
				</div>
			</div>
		`;
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

	function chartHtml() {
		const maxTotal = Math.max( 1, ...chartDays.map( ( d ) => d.total ) );

		return `
			<div class="acp-viz-root">
				<div style="background:var(--card);border:1px solid var(--border);border-radius:14px;padding:22px">
					<div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:6px">
						<div style="font-size:15px;font-weight:700">Artículos vendidos por día</div>
						<div style="font-size:12px;color:var(--text-faint2, var(--text-muted))">Últimos ${ CHART_DAYS } días</div>
					</div>
					${
						0 === chartVendors.length
							? '<div style="font-size:13px;color:var(--text-muted);padding:20px 0">Todavía no hay ventas suficientes para mostrar el gráfico.</div>'
							: `
						<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:18px">
							${ chartVendors
								.map(
									( v ) => `
								<div style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text-2, var(--text))">
									<span style="width:10px;height:10px;border-radius:2px;background:${ v.color };display:inline-block"></span>${ esc( v.name ) }
								</div>
							`
								)
								.join( '' ) }
						</div>
						<div style="display:flex;align-items:flex-end;gap:6px;height:160px">
							${ chartDays.map( ( d ) => dayBarHtml( d, maxTotal ) ).join( '' ) }
						</div>
					`
					}
				</div>
			</div>
		`;
	}

	function dayBarHtml( day, maxTotal ) {
		const heightPct = 0 === day.total ? 0 : Math.max( 4, Math.round( ( day.total / maxTotal ) * 100 ) );
		return `
			<div class="acp-chart-day" style="flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%">
				<div style="width:100%;max-width:24px;height:${ heightPct }%;display:flex;flex-direction:column;justify-content:flex-end">
					${ day.segments
						.map( ( seg, i ) => {
							const segPct = 0 === day.total ? 0 : ( seg.qty / day.total ) * 100;
							const isFirst = 0 === i;
							return `
							<div class="acp-chart-segment" data-tooltip="${ escAttr( seg.vendor.name + ': ' + seg.qty ) }"
								style="height:${ segPct }%;background:${ seg.vendor.color };${ isFirst ? 'border-radius:4px 4px 0 0;' : '' }${ i < day.segments.length - 1 ? 'margin-bottom:2px;' : '' }">
							</div>
						`;
						} )
						.join( '' ) }
				</div>
				<div class="acp-chart-daylabel" style="font-size:10px;color:var(--text-faint2, var(--text-muted));margin-top:8px;white-space:nowrap">${ esc( day.label ) }</div>
			</div>
		`;
	}
}

// OJO: nunca usar date.toISOString() acá — convierte a UTC, así que una
// venta hecha de noche (hora local) puede quedar registrada al día
// SIGUIENTE en el gráfico (ej. Chile va detrás de UTC). Se arma la fecha
// a mano con los componentes locales para que el "día" sea el mismo que
// ve la persona en su reloj.
function ymd( date ) {
	const y = date.getFullYear();
	const m = String( date.getMonth() + 1 ).padStart( 2, '0' );
	const d = String( date.getDate() ).padStart( 2, '0' );
	return `${ y }-${ m }-${ d }`;
}

function monthKey( date ) {
	return date.getFullYear() + '-' + String( date.getMonth() + 1 ).padStart( 2, '0' );
}

function date_i18n( date ) {
	return date.toLocaleDateString( 'es-CL', { day: '2-digit', month: '2-digit' } );
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
