export function renderDashboard( main, ctx ) {
	const { supabase, org } = ctx;
	let expenses = [];
	let stats = null;
	let saving = false;
	let errorMsg = '';

	load();

	async function load() {
		main.innerHTML = '<div class="acp-empty-state">Cargando…</div>';

		const startOfMonth = new Date();
		startOfMonth.setDate( 1 );
		startOfMonth.setHours( 0, 0, 0, 0 );
		const startOfDay = new Date();
		startOfDay.setHours( 0, 0, 0, 0 );

		const [ variantsRes, salesRes, expensesRes ] = await Promise.all( [
			supabase.from( 'product_variants' ).select( 'cost, price, stock_quantity' ).eq( 'organization_id', org.id ),
			supabase
				.from( 'sales' )
				.select( 'created_at, sale_items ( quantity, unit_price, unit_cost )' )
				.eq( 'organization_id', org.id )
				.gte( 'created_at', startOfMonth.toISOString() ),
			supabase
				.from( 'expenses' )
				.select( 'id, description, amount, category, expense_date' )
				.eq( 'organization_id', org.id )
				.gte( 'expense_date', ymd( startOfMonth ) )
				.order( 'expense_date', { ascending: false } ),
		] );

		if ( variantsRes.error || salesRes.error || expensesRes.error ) {
			errorMsg = 'No se pudo cargar el Dashboard: ' + ( variantsRes.error || salesRes.error || expensesRes.error ).message;
			draw();
			return;
		}

		let invested = 0;
		let potentialProfit = 0;
		( variantsRes.data || [] ).forEach( ( v ) => {
			invested += v.cost * v.stock_quantity;
			potentialProfit += ( v.price - v.cost ) * v.stock_quantity;
		} );

		let todaySold = 0;
		let todayProfit = 0;
		let monthSold = 0;
		let monthProfit = 0;
		( salesRes.data || [] ).forEach( ( s ) => {
			const isToday = new Date( s.created_at ) >= startOfDay;
			( s.sale_items || [] ).forEach( ( it ) => {
				const sold = it.unit_price * it.quantity;
				const profit = ( it.unit_price - it.unit_cost ) * it.quantity;
				monthSold += sold;
				monthProfit += profit;
				if ( isToday ) {
					todaySold += sold;
					todayProfit += profit;
				}
			} );
		} );

		expenses = expensesRes.data || [];
		const monthExpenses = expenses.reduce( ( sum, e ) => sum + Number( e.amount ), 0 );

		stats = {
			invested,
			potentialProfit,
			todaySold,
			todayProfit,
			monthSold,
			monthProfit,
			monthExpenses,
			netMonthProfit: monthProfit - monthExpenses,
		};

		draw();
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
				${ statCard( 'Monto invertido', money( stats.invested ), 'Costo de todo tu stock actual' ) }
				${ statCard( 'Ganancia potencial', money( stats.potentialProfit ), 'Si vendes todo el stock actual a precio de lista' ) }
			</div>

			<div style="font-size:13px;font-weight:700;color:var(--text-muted);margin-bottom:10px">Ventas</div>
			<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;margin-bottom:28px">
				${ splitStatCard( 'Ventas de hoy', stats.todaySold, stats.todayProfit ) }
				${ splitStatCard( 'Ventas del mes', stats.monthSold, stats.monthProfit ) }
			</div>

			<div style="font-size:13px;font-weight:700;color:var(--text-muted);margin-bottom:10px">Gastos y ganancia neta (este mes)</div>
			<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;margin-bottom:28px">
				${ statCard( 'Gastos del mes', money( stats.monthExpenses ), '' ) }
				${ statCard(
					'Ganancia neta del mes',
					money( stats.netMonthProfit ),
					'Utilidad de ventas menos gastos',
					stats.netMonthProfit >= 0 ? 'oklch(0.72 0.16 152)' : 'oklch(0.65 0.18 25)'
				) }
			</div>

			<div style="background:var(--card);border:1px solid var(--border);border-radius:14px;padding:20px;max-width:560px;margin-bottom:20px">
				<div style="font-size:14px;font-weight:700;margin-bottom:14px">Registrar gasto</div>
				<div style="display:grid;grid-template-columns:2fr 1fr;gap:10px;margin-bottom:10px">
					<input id="e-description" placeholder="Descripción (ej. publicidad Instagram)" style="background:var(--input-bg);border:1px solid var(--border);border-radius:8px;padding:10px 12px;color:var(--text);font-size:13px;font-family:inherit" />
					<input id="e-amount" type="number" step="0.01" placeholder="Monto" style="background:var(--input-bg);border:1px solid var(--border);border-radius:8px;padding:10px 12px;color:var(--text);font-size:13px;font-family:inherit" />
				</div>
				<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
					<input id="e-category" placeholder="Categoría (opcional)" style="background:var(--input-bg);border:1px solid var(--border);border-radius:8px;padding:10px 12px;color:var(--text);font-size:13px;font-family:inherit" />
					<input id="e-date" type="date" value="${ ymd( new Date() ) }" style="background:var(--input-bg);border:1px solid var(--border);border-radius:8px;padding:10px 12px;color:var(--text);font-size:13px;font-family:inherit" />
				</div>
				<button type="button" class="acp-btn-primary" id="e-save" ${ saving ? 'disabled' : '' } style="width:auto;padding:10px 20px">${ saving ? 'Guardando…' : 'Agregar gasto' }</button>
			</div>

			<div style="font-size:15px;font-weight:700;margin-bottom:12px">Gastos de este mes</div>
			${ 0 === expenses.length ? '<div class="acp-empty-state">Todavía no hay gastos registrados este mes.</div>' : expensesTableHtml() }
		`;

		document.getElementById( 'e-save' ).addEventListener( 'click', handleAddExpense );
	}

	function statCard( label, value, hint, color ) {
		return `
			<div style="background:var(--card);border:1px solid var(--border);border-radius:14px;padding:20px">
				<div style="font-size:13px;color:var(--text-muted);font-weight:600;margin-bottom:10px">${ esc( label ) }</div>
				<div style="font-size:24px;font-weight:800;letter-spacing:-0.01em${ color ? `;color:${ color }` : '' }">${ value }</div>
				${ hint ? `<div style="font-size:11px;color:var(--text-faint2, var(--text-muted));margin-top:6px">${ esc( hint ) }</div>` : '' }
			</div>
		`;
	}

	function splitStatCard( label, sold, profit ) {
		return `
			<div style="background:var(--card);border:1px solid var(--border);border-radius:14px;padding:20px">
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

	function expensesTableHtml() {
		return `
			<div style="background:var(--card);border:1px solid var(--border);border-radius:14px;overflow:hidden">
				<div style="display:grid;grid-template-columns:1fr 2fr 1fr 1fr;gap:12px;padding:12px 18px;font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;border-bottom:1px solid var(--border)">
					<div>Fecha</div><div>Descripción</div><div>Categoría</div><div>Monto</div>
				</div>
				${ expenses
					.map(
						( e ) => `
					<div style="display:grid;grid-template-columns:1fr 2fr 1fr 1fr;gap:12px;padding:12px 18px;font-size:13px;border-bottom:1px solid var(--border)">
						<div>${ esc( e.expense_date ) }</div>
						<div>${ esc( e.description ) }</div>
						<div style="color:var(--text-muted)">${ esc( e.category || '—' ) }</div>
						<div style="font-weight:700">${ money( e.amount ) }</div>
					</div>
				`
					)
					.join( '' ) }
			</div>
		`;
	}

	async function handleAddExpense() {
		const description = document.getElementById( 'e-description' ).value.trim();
		const amount = parseFloat( document.getElementById( 'e-amount' ).value );
		const category = document.getElementById( 'e-category' ).value.trim();
		const expenseDate = document.getElementById( 'e-date' ).value;

		if ( '' === description || ! ( amount > 0 ) ) {
			errorMsg = 'Descripción y monto (mayor a 0) son obligatorios.';
			draw();
			return;
		}

		saving = true;
		errorMsg = '';
		draw();

		const { error } = await supabase.from( 'expenses' ).insert( {
			organization_id: org.id,
			description,
			amount,
			category: category || null,
			expense_date: expenseDate,
		} );

		saving = false;

		if ( error ) {
			errorMsg = 'No se pudo guardar el gasto: ' + error.message;
			draw();
			return;
		}

		await load();
	}
}

function ymd( date ) {
	return date.toISOString().slice( 0, 10 );
}

function money( n ) {
	return '$' + Number( n ).toLocaleString( 'es-CL', { maximumFractionDigits: 0 } );
}

function esc( str ) {
	const div = document.createElement( 'div' );
	div.textContent = str ?? '';
	return div.innerHTML;
}
